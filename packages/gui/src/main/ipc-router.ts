import { type App, dialog, type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import {
	AppBootstrap,
	CommandNotImplemented,
	type GuiCommand,
	type GuiCommandResult,
	type GuiError,
	type GuiEvent,
	InvalidRendererCommand,
	InternalIpcError,
	ReceiptEmitted,
	SessionArchive,
	SessionCancelRun,
	SessionClose,
	SessionCatalogUpdated,
	SessionCreate,
	SessionGetTranscript,
	SessionOpen,
	SessionRename,
	SessionSendMessage,
	SessionSelected,
	SessionUnarchive,
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
import { PiSdkSessionDriver } from "./session/pi-sdk-session-driver.ts";
import { RuntimeSupervisor } from "./session/runtime-supervisor.ts";
import { SessionSupervisor } from "./session/session-supervisor.ts";

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
	sessionSupervisor?: Pick<
		SessionSupervisor,
		"cancelRun" | "closeSession" | "createSession" | "getTranscript" | "openSession" | "sendMessage"
	>;
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
	const runtimeSupervisor = new RuntimeSupervisor();
	const sessionSupervisor = new SessionSupervisor({
		catalogService,
		driver: new PiSdkSessionDriver({ runtimeSupervisor }),
		eventBus,
	});
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

	if (command instanceof AppBootstrap) {
		options.eventBus.publishReceipt(command.requestId, "app.bootstrap.accepted");
		const workspaceCatalog = await catalogService.getWorkspaceCatalog();
		const startupWarning = catalogService.getStartupWarning();
		const data = {
			appInfo: createAppInfo(options.app, options.mode),
			workspaceCatalog,
			...(startupWarning ? { warnings: [startupWarning] } : {}),
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
			options.eventBus.publishReceipt(command.requestId, `${command._tag}.completed`);
			return { ok: true, requestId: command.requestId, data: sessions };
		}

		if (command instanceof SessionOpen) {
			const sessions = options.sessionSupervisor
				? await options.sessionSupervisor.openSession(command.workspaceId, command.sessionId)
				: await catalogService.openSession(command.workspaceId, command.sessionId);
			publishSessionCatalog(options.eventBus, sessions);
			publishSelectedSession(options.eventBus, sessions);
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
	return { ok: false, requestId: requestIdFromString(requestId), error };
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

async function toGuiError(error: unknown): Promise<GuiError> {
	try {
		return await decodeGuiError(error);
	} catch {
		return new InternalIpcError({ message: "Unhandled GUI IPC error", cause: getErrorMessage(error) });
	}
}
