import { type App, dialog, type IpcMainInvokeEvent, ipcMain, shell, type WebContents } from "electron";
import {
	AppBootstrap,
	AppError,
	CommandNotImplemented,
	ExtensionUiRespond,
	ExtensionUiUpdateEditorText,
	type GuiCommand,
	type GuiCommandResult,
	type GuiError,
	type GuiEvent,
	InvalidRendererCommand,
	InternalIpcError,
	ReceiptEmitted,
	ResumeArchive,
	ResumeOpen,
	ResumeRename,
	ResumeSearch,
	ResumeUnarchive,
	SettingsGetSummary,
	SettingsOpenGlobalFile,
	SettingsOpenProjectFile,
	SettingsRevealGlobalFile,
	SettingsRevealProjectFile,
	SettingsSummaryUpdated,
	SessionArchive,
	SessionCancelRun,
	SessionClose,
	SessionCatalogUpdated,
	SessionCreate,
	SessionGetTranscript,
	SessionGetSlashCommands,
	SessionOpen,
	SessionRename,
	SessionRestoreQueuedMessages,
	SessionSendMessage,
	SessionSetModel,
	SessionSetThinkingLevel,
	SessionSelected,
	SessionUnarchive,
	TrustGetStatus,
	TrustStatusUpdated,
	UnauthorizedIpcSender,
	WorkspaceAdd,
	WorkspaceCatalogUpdated,
	WorkspacePickDirectory,
	WorkspaceRemove,
	WorkspaceSelect,
	WorkspaceSync,
	WorkspaceSynced,
	decodeGuiError,
	decodeGuiCommand,
	eventIdFromString,
	requestIdFromString,
} from "../contracts/index.ts";
import { PI_GUI_EVENT_CHANNEL, PI_GUI_INVOKE_CHANNEL } from "../shared/contracts.ts";
import type { AppOriginPolicy } from "./app-origin-policy.ts";
import { createAppInfo } from "./app-info.ts";
import { isAllowedAppUrl } from "./app-origin-policy.ts";
import { CatalogService } from "./catalog/catalog-service.ts";
import { SettingsBridgeService } from "./settings/settings-bridge-service.ts";
import { ExtensionHostUiService } from "./session/extension-host-ui-service.ts";
import { FakeSessionDriver, shouldUseFakeSessionDriver } from "./session/fake-session-driver.ts";
import { PiSdkSessionDriver } from "./session/pi-sdk-session-driver.ts";
import { ResumeService } from "./session/resume-service.ts";
import { RuntimeSupervisor } from "./session/runtime-supervisor.ts";
import type { SessionDriver } from "./session/session-driver.ts";
import { SessionSupervisor } from "./session/session-supervisor.ts";
import { SlashCommandService } from "./session/slash-command-service.ts";

export interface GuiIpcInvokeEvent {
	senderFrame: { url: string } | null;
	sender: RendererEventSender;
}

export interface CreateGuiInvokeHandlerOptions {
	app: Pick<App, "getName" | "getVersion">;
	catalogService?: CatalogService;
	eventBus: RendererEventBus;
	mode: string | undefined;
	pickWorkspaceDirectory?: () => Promise<string | undefined>;
	policy: AppOriginPolicy;
	settingsBridgeService?: Pick<
		SettingsBridgeService,
		"getSummary" | "getTrustStatus" | "openSettingsFile" | "revealSettingsFile"
	>;
	resumeService?: Pick<ResumeService, "archive" | "open" | "rename" | "search" | "unarchive">;
	sessionSupervisor?: Pick<
		SessionSupervisor,
		| "cancelRun"
		| "closeSession"
		| "createSession"
		| "getModelThinking"
		| "getTranscript"
		| "openSession"
		| "restoreQueuedMessages"
		| "respondToExtensionUi"
		| "sendMessage"
		| "setModel"
		| "setThinkingLevel"
		| "updateExtensionEditorText"
	>;
	slashCommandService?: Pick<SlashCommandService, "getCatalog">;
}

type RendererEventSender = Pick<WebContents, "id" | "isDestroyed" | "once" | "send">;

export class RendererEventBus {
	private sequence = 0;
	private senders = new Map<number, RendererEventSender>();

	registerSender(sender: RendererEventSender): void {
		if (sender.isDestroyed()) return;
		if (this.senders.has(sender.id)) return;

		this.senders.set(sender.id, sender);
		sender.once("destroyed", () => {
			this.senders.delete(sender.id);
		});
	}

	publishReceipt(requestId: string, receipt: string): void {
		this.publish(
			new ReceiptEmitted({
				...this.nextEventBase(),
				receipt,
				requestId: requestIdFromString(requestId),
			}),
		);
	}

	publish(event: GuiEvent): void {
		this.sequence = event.sequence;
		for (const [senderId, sender] of this.senders) {
			if (sender.isDestroyed()) {
				this.senders.delete(senderId);
				continue;
			}
			sender.send(PI_GUI_EVENT_CHANNEL, event);
		}
	}

	nextEventBase(): { eventId: ReturnType<typeof eventIdFromString>; sequence: number } {
		const sequence = this.sequence + 1;
		return { eventId: eventIdFromString(`event-${sequence}`), sequence };
	}
}

export function createGuiInvokeHandler(options: CreateGuiInvokeHandlerOptions) {
	return async (event: GuiIpcInvokeEvent, payload: unknown): Promise<GuiCommandResult> => {
		const requestId = getRequestId(payload);
		const senderError = validateSender(options.policy, event);
		if (senderError) return failureResult(requestId, senderError);
		options.eventBus.registerSender(event.sender);

		const command = await decodeCommand(payload);
		if (command instanceof InvalidRendererCommand) return failureResult(requestId, command);

		return handleGuiCommand(command, options);
	};
}

export function registerGuiIpcHandlers(app: App, mode: string | undefined, policy: AppOriginPolicy): RendererEventBus {
	const eventBus = new RendererEventBus();
	const catalogService = new CatalogService();
	const extensionHostUiService = new ExtensionHostUiService(eventBus);
	const runtimeSupervisor = new RuntimeSupervisor({
		createExtensionUiContext: (workspaceId, sessionId) =>
			extensionHostUiService.createContext(workspaceId, sessionId),
	});
	const settingsBridgeService = new SettingsBridgeService({ catalogService, shell });
	const driver: SessionDriver = shouldUseFakeSessionDriver()
		? new FakeSessionDriver({ extensionHostUiService })
		: new PiSdkSessionDriver({ runtimeSupervisor });
	const sessionSupervisor = new SessionSupervisor({
		catalogService,
		driver,
		eventBus,
		extensionHostUiService,
	});
	const resumeService = new ResumeService({ catalogService, sessionSupervisor });
	const slashCommandService = new SlashCommandService({ sessionSupervisor });
	const handler = createGuiInvokeHandler({
		app,
		catalogService,
		eventBus,
		mode,
		pickWorkspaceDirectory: async () => {
			const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
			return result.canceled ? undefined : result.filePaths[0];
		},
		policy,
		resumeService,
		settingsBridgeService,
		slashCommandService,
		sessionSupervisor,
	});

	ipcMain.handle(PI_GUI_INVOKE_CHANNEL, (event: IpcMainInvokeEvent, payload: unknown) => handler(event, payload));

	return eventBus;
}

async function decodeCommand(payload: unknown): Promise<GuiCommand | InvalidRendererCommand> {
	try {
		return await decodeGuiCommand(payload);
	} catch (error) {
		return new InvalidRendererCommand({
			message: "Invalid renderer command",
			cause: getErrorMessage(error),
		});
	}
}

async function handleGuiCommand(
	command: GuiCommand,
	options: CreateGuiInvokeHandlerOptions,
): Promise<GuiCommandResult> {
	const catalogService = options.catalogService ?? new CatalogService();
	const settingsBridgeService = options.settingsBridgeService ?? new SettingsBridgeService({ catalogService, shell });

	if (command instanceof AppBootstrap) {
		options.eventBus.publishReceipt(command.requestId, "app.bootstrap.accepted");
		const workspaceCatalog = await catalogService.getWorkspaceCatalog();
		const startupWarning = catalogService.getStartupWarning();
		const data = {
			appInfo: createAppInfo(options.app, options.mode),
			workspaceCatalog,
			...(startupWarning ? { warnings: [serializeGuiError(startupWarning)] } : {}),
		};
		options.eventBus.publishReceipt(command.requestId, "app.bootstrap.completed");
		return { ok: true, requestId: command.requestId, data };
	}

	if (!(command instanceof SessionSendMessage) && !(command instanceof SessionCancelRun)) {
		options.eventBus.publishReceipt(command.requestId, `${command._tag}.accepted`);
	}

	try {
		if (command instanceof WorkspaceAdd) {
			const catalog = await catalogService.addWorkspace(command.path);
			publishWorkspaceCatalog(options.eventBus, catalog);
			await publishSelectedWorkspaceSessions(options.eventBus, catalogService, catalog.selectedWorkspaceId, true);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: catalog };
		}

		if (command instanceof WorkspacePickDirectory) {
			const selectedPath = await options.pickWorkspaceDirectory?.();
			const catalog = selectedPath
				? await catalogService.addWorkspace(selectedPath)
				: await catalogService.getWorkspaceCatalog();
			publishWorkspaceCatalog(options.eventBus, catalog);
			if (selectedPath) {
				await publishSelectedWorkspaceSessions(options.eventBus, catalogService, catalog.selectedWorkspaceId, true);
			}
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: catalog };
		}

		if (command instanceof WorkspaceSelect) {
			const catalog = await catalogService.selectWorkspace(command.workspaceId);
			publishWorkspaceCatalog(options.eventBus, catalog);
			await publishSelectedWorkspaceSessions(options.eventBus, catalogService, catalog.selectedWorkspaceId, false);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: catalog };
		}

		if (command instanceof WorkspaceSync) {
			const sessions = await catalogService.syncWorkspace(command.workspaceId);
			publishSessionCatalog(options.eventBus, sessions);
			publishWorkspaceSynced(options.eventBus, command.workspaceId, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof WorkspaceRemove) {
			const catalog = await catalogService.removeWorkspace(command.workspaceId);
			publishWorkspaceCatalog(options.eventBus, catalog);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: catalog };
		}

		if (command instanceof SessionCreate) {
			const sessions = options.sessionSupervisor
				? await options.sessionSupervisor.createSession(command.workspaceId)
				: await catalogService.createSession(command.workspaceId);
			publishSessionCatalog(options.eventBus, sessions);
			publishSelectedSession(options.eventBus, sessions);
			await publishWorkspaceRuntimeContext(options.eventBus, settingsBridgeService, command.workspaceId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof SessionOpen) {
			const sessions = options.sessionSupervisor
				? await options.sessionSupervisor.openSession(command.workspaceId, command.sessionId)
				: await catalogService.openSession(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			publishSelectedSession(options.eventBus, sessions);
			await publishWorkspaceRuntimeContext(options.eventBus, settingsBridgeService, command.workspaceId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof SessionClose && options.sessionSupervisor) {
			await options.sessionSupervisor.closeSession(command.workspaceId, command.sessionId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SessionGetTranscript && options.sessionSupervisor) {
			const timeline = await options.sessionSupervisor.getTranscript(command.workspaceId, command.sessionId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: timeline };
		}

		if (command instanceof SessionGetSlashCommands && options.slashCommandService) {
			const catalog = await options.slashCommandService.getCatalog(command.workspaceId, command.sessionId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: catalog };
		}

		if (command instanceof ResumeSearch && options.resumeService) {
			const snapshot = await options.resumeService.search({
				workspaceId: command.workspaceId,
				query: command.query,
				scope: command.scope,
				sortMode: command.sortMode,
				nameFilter: command.nameFilter,
				includeArchived: command.includeArchived,
			});
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: snapshot };
		}

		if (command instanceof ResumeOpen && options.resumeService) {
			const sessions = await options.resumeService.open(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			publishSelectedSession(options.eventBus, sessions);
			await publishWorkspaceRuntimeContext(options.eventBus, settingsBridgeService, command.workspaceId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof ResumeRename && options.resumeService) {
			const sessions = await options.resumeService.rename(command.workspaceId, command.sessionId, command.title);
			publishSessionCatalog(options.eventBus, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof ResumeArchive && options.resumeService) {
			const sessions = await options.resumeService.archive(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof ResumeUnarchive && options.resumeService) {
			const sessions = await options.resumeService.unarchive(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof SessionSendMessage && options.sessionSupervisor) {
			await options.sessionSupervisor.sendMessage({
				requestId: command.requestId,
				workspaceId: command.workspaceId,
				sessionId: command.sessionId,
				message: command.message,
				...(command.deliveryMode ? { deliveryMode: command.deliveryMode } : {}),
			});
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SessionCancelRun && options.sessionSupervisor) {
			await options.sessionSupervisor.cancelRun(command.workspaceId, command.sessionId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SessionRestoreQueuedMessages && options.sessionSupervisor) {
			const restored = await options.sessionSupervisor.restoreQueuedMessages(command.workspaceId, command.sessionId);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: restored };
		}

		if (command instanceof SessionSetModel && options.sessionSupervisor) {
			const snapshot = await options.sessionSupervisor.setModel(
				command.workspaceId,
				command.sessionId,
				command.provider,
				command.modelId,
			);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: snapshot };
		}

		if (command instanceof SessionSetThinkingLevel && options.sessionSupervisor) {
			const snapshot = await options.sessionSupervisor.setThinkingLevel(
				command.workspaceId,
				command.sessionId,
				command.thinkingLevel,
			);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: snapshot };
		}

		if (command instanceof ExtensionUiRespond && options.sessionSupervisor) {
			options.sessionSupervisor.respondToExtensionUi({
				workspaceId: command.workspaceId,
				sessionId: command.sessionId,
				extensionUiRequestId: command.extensionUiRequestId,
				response: command.response,
			});
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof ExtensionUiUpdateEditorText && options.sessionSupervisor) {
			options.sessionSupervisor.updateExtensionEditorText(command.workspaceId, command.sessionId, command.text);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SettingsGetSummary) {
			const summary = await settingsBridgeService.getSummary(command.workspaceId);
			options.eventBus.publish(new SettingsSummaryUpdated({ ...options.eventBus.nextEventBase(), summary }));
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: summary };
		}

		if (command instanceof SettingsOpenGlobalFile) {
			await settingsBridgeService.openSettingsFile(command.workspaceId, "global");
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SettingsRevealGlobalFile) {
			await settingsBridgeService.revealSettingsFile(command.workspaceId, "global");
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SettingsOpenProjectFile) {
			await settingsBridgeService.openSettingsFile(command.workspaceId, "project");
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof SettingsRevealProjectFile) {
			await settingsBridgeService.revealSettingsFile(command.workspaceId, "project");
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: undefined };
		}

		if (command instanceof TrustGetStatus) {
			const status = await settingsBridgeService.getTrustStatus(command.workspaceId);
			options.eventBus.publish(new TrustStatusUpdated({ ...options.eventBus.nextEventBase(), status }));
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: status };
		}

		if (command instanceof SessionRename) {
			const sessions = await catalogService.renameSession(command.workspaceId, command.sessionId, command.title);
			publishSessionCatalog(options.eventBus, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof SessionArchive) {
			const sessions = await catalogService.archiveSession(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof SessionUnarchive) {
			const sessions = await catalogService.unarchiveSession(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		return failureResult(
			command.requestId,
			new CommandNotImplemented({
				commandTag: command._tag,
				message: `${command._tag} is not implemented in Phase 4`,
			}),
		);
	} catch (error) {
		const guiError = await toGuiError(error);
		if (guiError._tag === "WorkspacePathMissing") {
			await publishCurrentWorkspaceCatalog(options.eventBus, catalogService);
		}
		return failureResult(command.requestId, guiError);
	}
}

function validateSender(policy: AppOriginPolicy, event: GuiIpcInvokeEvent): UnauthorizedIpcSender | undefined {
	if (!event.senderFrame) {
		return new UnauthorizedIpcSender({ message: "Blocked IPC from missing sender frame" });
	}
	if (!isAllowedAppUrl(policy, event.senderFrame.url)) {
		return new UnauthorizedIpcSender({
			message: `Blocked IPC from untrusted renderer URL: ${event.senderFrame.url}`,
		});
	}
	return undefined;
}

function failureResult(requestId: string, error: GuiError): GuiCommandResult {
	return { ok: false, requestId: requestIdFromString(requestId), error: serializeGuiError(error) };
}

function serializeGuiError(error: GuiError): GuiError {
	return {
		...error,
		message: error.message,
		...(typeof error.cause === "string" ? { cause: error.cause } : {}),
	};
}

function getRequestId(payload: unknown): string {
	if (typeof payload !== "object" || !payload || !("requestId" in payload)) return "unknown-request";
	const requestId = (payload as { requestId: unknown }).requestId;
	return typeof requestId === "string" && requestId.length > 0 ? requestId : "unknown-request";
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function publishWorkspaceCatalog(
	eventBus: RendererEventBus,
	catalog: ConstructorParameters<typeof WorkspaceCatalogUpdated>[0]["catalog"],
): void {
	eventBus.publish(new WorkspaceCatalogUpdated({ ...eventBus.nextEventBase(), catalog }));
}

function publishSessionCatalog(
	eventBus: RendererEventBus,
	catalog: ConstructorParameters<typeof WorkspaceSynced>[0]["sessions"],
): void {
	eventBus.publish(
		new SessionCatalogUpdated({
			...eventBus.nextEventBase(),
			workspaceId: catalog.workspaceId,
			sessions: catalog.sessions,
		}),
	);
}

function publishWorkspaceSynced(
	eventBus: RendererEventBus,
	workspaceId: ConstructorParameters<typeof WorkspaceSynced>[0]["workspaceId"],
	sessions: ConstructorParameters<typeof WorkspaceSynced>[0]["sessions"],
): void {
	eventBus.publish(new WorkspaceSynced({ ...eventBus.nextEventBase(), workspaceId, sessions }));
}

function publishSelectedSession(
	eventBus: RendererEventBus,
	catalog: ConstructorParameters<typeof WorkspaceSynced>[0]["sessions"],
): void {
	if (!catalog.selectedSessionId) return;
	eventBus.publish(
		new SessionSelected({
			...eventBus.nextEventBase(),
			workspaceId: catalog.workspaceId,
			sessionId: catalog.selectedSessionId,
		}),
	);
}

async function publishSelectedWorkspaceSessions(
	eventBus: RendererEventBus,
	catalogService: CatalogService,
	workspaceId: ConstructorParameters<typeof WorkspaceSynced>[0]["workspaceId"] | undefined,
	emitSynced: boolean,
): Promise<void> {
	if (!workspaceId) return;
	const sessions = await catalogService.getSessionCatalog(workspaceId);
	publishSessionCatalog(eventBus, sessions);
	if (emitSynced) publishWorkspaceSynced(eventBus, workspaceId, sessions);
}

async function publishCurrentWorkspaceCatalog(
	eventBus: RendererEventBus,
	catalogService: CatalogService,
): Promise<void> {
	try {
		publishWorkspaceCatalog(eventBus, await catalogService.getWorkspaceCatalog());
	} catch {
		return;
	}
}

async function publishWorkspaceRuntimeContext(
	eventBus: RendererEventBus,
	settingsBridgeService: Pick<SettingsBridgeService, "getSummary" | "getTrustStatus">,
	workspaceId: ConstructorParameters<typeof SettingsSummaryUpdated>[0]["summary"]["workspaceId"],
): Promise<void> {
	try {
		eventBus.publish(
			new SettingsSummaryUpdated({
				...eventBus.nextEventBase(),
				summary: await settingsBridgeService.getSummary(workspaceId),
			}),
		);
		eventBus.publish(
			new TrustStatusUpdated({
				...eventBus.nextEventBase(),
				status: await settingsBridgeService.getTrustStatus(workspaceId),
			}),
		);
	} catch (error) {
		eventBus.publish(
			new AppError({
				...eventBus.nextEventBase(),
				error: await toGuiError(error),
			}),
		);
	}
}

async function toGuiError(error: unknown): Promise<GuiError> {
	try {
		return await decodeGuiError(error);
	} catch {
		return new InternalIpcError({ message: "Unhandled GUI IPC error", cause: getErrorMessage(error) });
	}
}
