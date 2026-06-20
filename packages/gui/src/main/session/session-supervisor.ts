import {
	CompactionCancelled,
	CompactionCompleted,
	CompactionFailed,
	CompactionStarted,
	ModelThinkingUpdated,
	QueueUpdated,
	ReceiptEmitted,
	RunCancelled,
	RunCompleted,
	RunFailed,
	RunStarted,
	SessionCancelFailed,
	SessionCompactFailed,
	SessionClosed,
	SessionFileMissing,
	SessionActivityUpdated,
	SessionOpenLimitReached,
	SessionOpened,
	SessionPromptFailed,
	ResourceInventoryReadFailed,
	ResourceReloadFailed,
	ResourcesInventoryUpdated,
	SessionRuntimeNotOpen,
	SessionRuntimeNotFound,
	SessionRunNotActive,
	SessionStatusChanged,
	SessionTreeLabelUpdateFailed,
	SessionTreeNavigationFailed,
	TimelineMessageDelta,
	ToolFinished,
	ToolStarted,
	ToolUpdated,
	TreeNavigationCompleted,
	TreeNavigationFailed,
	TreeNavigationStarted,
	TreeUpdated,
	WorkspaceNotFound,
	type GuiEvent,
	type ExtensionUiRequestId,
	type ModelThinkingSnapshot,
	type QueueSnapshot,
	type ResourceInventorySnapshot,
	type QueueRestoreSnapshot,
	type RequestId,
	type RunId,
	type SessionCatalogSnapshot,
	type SessionCompactionSnapshot,
	type SessionExportSnapshot,
	type SessionId,
	type SessionSnapshot,
	type SessionTreeSnapshot,
	type SlashCommandSnapshot,
	type TimelineSnapshot,
	type ThinkingLevel,
	type TreeNavigationSnapshot,
	type TreeNavigationSummaryMode,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
	runIdFromString,
} from "../../contracts/index.ts";
import { projectQueueSnapshot } from "./queue-projection.ts";
import { consumeSessionImages, type SessionImageAttachmentResolver } from "./session-attachments.ts";
import { exportReadySession, type SessionArtifactTracker } from "./session-export.ts";
import { createRuntimeSessionKey, type RuntimeSessionKey } from "./session-key.ts";
import {
	findSelectedSession,
	findSession,
	getErrorMessage,
	stringifyEventValue,
	withStatus,
} from "./session-supervisor-utils.ts";
import type { ExtensionHostUiService, ExtensionUiResponse } from "./extension-host-ui-service.ts";
import type { RuntimeSessionEvent, RuntimeSessionHandle, SessionDriver } from "./session-driver.ts";

export interface SessionCatalogRuntimeService {
	createSession(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot>;
	getSessionCatalog(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot>;
	getWorkspaceCatalog(): Promise<WorkspaceCatalogSnapshot>;
	openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot>;
}

export interface SessionSupervisorEventBus {
	nextEventBase(): ConstructorParameters<typeof SessionOpened>[0] extends infer Payload
		? Payload extends { eventId: infer EventId; sequence: number }
			? { eventId: EventId; sequence: number }
			: never
		: never;
	publish(event: GuiEvent): void;
}

export interface SessionSupervisorOptions {
	catalogService: SessionCatalogRuntimeService;
	driver: SessionDriver;
	eventBus: SessionSupervisorEventBus;
	extensionHostUiService?: Pick<ExtensionHostUiService, "cancelSessionRequests" | "respond" | "updateEditorText">;
	imageAttachmentService?: SessionImageAttachmentResolver & {
		clearSession(workspaceId: WorkspaceId, sessionId: SessionId): void;
	};
	artifactService?: SessionArtifactTracker;
	maxOpenSessions?: number;
}

interface ManagedSessionRecord {
	activeRunId?: RunId;
	handle: RuntimeSessionHandle;
	lastActivitySequence: number;
	manualCompactionActive: boolean;
	manualCompactionCancelling: boolean;
	needsInput: boolean;
	queueSnapshot: QueueSnapshot;
	session: SessionSnapshot;
	treeNavigationActive: boolean;
	treeNavigationCancelling: boolean;
	unsubscribe: () => void;
}

export class SessionSupervisor {
	private readonly catalogService: SessionCatalogRuntimeService;
	private readonly driver: SessionDriver;
	private readonly eventBus: SessionSupervisorEventBus;
	private readonly artifactService: SessionSupervisorOptions["artifactService"];
	private readonly extensionHostUiService: SessionSupervisorOptions["extensionHostUiService"];
	private readonly imageAttachmentService: SessionSupervisorOptions["imageAttachmentService"];
	private readonly maxOpenSessions: number;
	private readonly records = new Map<RuntimeSessionKey, ManagedSessionRecord>();
	private runSequence = 0;

	constructor(options: SessionSupervisorOptions) {
		this.catalogService = options.catalogService;
		this.driver = options.driver;
		this.eventBus = options.eventBus;
		this.artifactService = options.artifactService;
		this.extensionHostUiService = options.extensionHostUiService;
		this.imageAttachmentService = options.imageAttachmentService;
		this.maxOpenSessions = options.maxOpenSessions ?? 4;
	}

	hasRuntime(workspaceId: WorkspaceId, sessionId: SessionId): boolean {
		return this.records.has(createRuntimeSessionKey(workspaceId, sessionId));
	}

	async createSession(workspaceId: WorkspaceId): Promise<SessionCatalogSnapshot> {
		this.assertCanOpenNewRuntime(workspaceId);
		const catalog = await this.catalogService.createSession(workspaceId);
		const session = findSelectedSession(catalog);
		await this.openRuntimeForSession(session);
		return catalog;
	}

	async openSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionCatalogSnapshot> {
		if (this.hasRuntime(workspaceId, sessionId)) {
			return this.catalogService.openSession(workspaceId, sessionId);
		}
		this.assertCanOpenNewRuntime(workspaceId, sessionId);
		const existingCatalog = await this.catalogService.getSessionCatalog(workspaceId);
		findSession(existingCatalog, sessionId);
		const catalog = await this.catalogService.openSession(workspaceId, sessionId);
		const session = findSession(catalog, sessionId);
		await this.openRuntimeForSession(session);
		return catalog;
	}

	async closeSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const record = this.records.get(key);
		if (!record) {
			throw new SessionRuntimeNotFound({
				workspaceId,
				sessionId,
				message: `Session runtime ${key} is not open`,
			});
		}

		await this.driver.closeSession(record.handle);
		this.extensionHostUiService?.cancelSessionRequests(workspaceId, sessionId);
		this.imageAttachmentService?.clearSession(workspaceId, sessionId);
		record.unsubscribe();
		this.records.delete(key);
		this.eventBus.publish(new SessionClosed({ ...this.eventBus.nextEventBase(), workspaceId, sessionId }));
	}

	async sendMessage(request: {
		requestId: RequestId;
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		message: string;
		deliveryMode?: "steer" | "followUp";
		attachmentIds?: readonly string[];
	}): Promise<void> {
		const record = this.getRecord(request.workspaceId, request.sessionId);
		const images = await this.consumeImages(request.workspaceId, request.sessionId, request.attachmentIds);
		if (request.deliveryMode) {
			if (!record.activeRunId) {
				throw new SessionRunNotActive({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					message: `Session runtime ${record.handle.key} has no active run`,
				});
			}
			await this.driver.sendMessage(record.handle, {
				message: request.message,
				deliveryMode: request.deliveryMode,
				...(images ? { images } : {}),
			});
			this.publishAcceptedReceipt(request.requestId);
			return;
		}

		const result = await this.driver.sendMessage(record.handle, {
			message: request.message,
			...(images ? { images } : {}),
		});
		const runId = this.createRunId(request.workspaceId, request.sessionId);
		record.activeRunId = runId;
		this.publishAcceptedReceipt(request.requestId);
		this.eventBus.publish(
			new RunStarted({
				...this.eventBus.nextEventBase(),
				runId,
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
			}),
		);
		this.setRecordStatus(record, "running");
		void result.completion.then(
			() => {
				void this.completeRun(record, runId).catch((error: unknown) => {
					this.failRun(record, runId, error);
				});
			},
			(error: unknown) => {
				this.failRun(record, runId, error);
			},
		);
	}

	async cancelRun(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
		const record = this.getRecord(workspaceId, sessionId);
		const runId = record.activeRunId;
		if (!runId) {
			throw new SessionRunNotActive({
				workspaceId,
				sessionId,
				message: `Session runtime ${record.handle.key} has no active run`,
			});
		}
		this.setRecordStatus(record, "cancelling");
		try {
			await this.driver.cancelRun(record.handle);
		} catch (error) {
			this.setRecordStatus(record, "running");
			throw new SessionCancelFailed({
				workspaceId,
				sessionId,
				runId,
				message: "Failed to cancel Pi session run",
				cause: getErrorMessage(error),
			});
		}
		record.activeRunId = undefined;
		this.eventBus.publish(new RunCancelled({ ...this.eventBus.nextEventBase(), runId, workspaceId, sessionId }));
		this.setRecordStatus(record, "ready");
	}

	async getTranscript(workspaceId: WorkspaceId, sessionId: SessionId): Promise<TimelineSnapshot> {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const record = this.records.get(key);
		if (!record) {
			throw new SessionRuntimeNotFound({
				workspaceId,
				sessionId,
				message: `Session runtime ${key} is not open`,
			});
		}
		return this.driver.getTranscript(record.handle);
	}

	async getTree(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionTreeSnapshot> {
		return this.driver.getTree(this.getRecord(workspaceId, sessionId).handle);
	}

	async setTreeEntryLabel(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		entryId: string,
		label: string | undefined,
	): Promise<SessionTreeSnapshot> {
		const record = this.getRecord(workspaceId, sessionId);
		try {
			const tree = await this.driver.setTreeEntryLabel(record.handle, entryId, label);
			this.publishTree(tree);
			return tree;
		} catch (error) {
			if (error instanceof SessionTreeLabelUpdateFailed) throw error;
			throw new SessionTreeLabelUpdateFailed({
				workspaceId,
				sessionId,
				entryId,
				message: "Failed to update Pi session tree label",
				cause: getErrorMessage(error),
			});
		}
	}

	async navigateTree(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		targetEntryId: string;
		summaryMode: TreeNavigationSummaryMode;
		customInstructions?: string;
		label?: string;
	}): Promise<TreeNavigationSnapshot> {
		const record = this.getRecord(request.workspaceId, request.sessionId);
		if (record.activeRunId) {
			throw new SessionTreeNavigationFailed({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				targetEntryId: request.targetEntryId,
				message: "Tree navigation is unavailable while a prompt run is active",
			});
		}
		this.eventBus.publish(
			new TreeNavigationStarted({
				...this.eventBus.nextEventBase(),
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				targetEntryId: request.targetEntryId,
			}),
		);
		this.setRecordStatus(record, "navigating");
		record.treeNavigationActive = true;
		record.treeNavigationCancelling = false;
		try {
			const result = await this.driver.navigateTree(record.handle, {
				targetEntryId: request.targetEntryId,
				summaryMode: request.summaryMode,
				...(request.customInstructions ? { customInstructions: request.customInstructions } : {}),
				...(request.label ? { label: request.label } : {}),
			});
			this.publishTree(result.tree);
			this.eventBus.publish(new TreeNavigationCompleted({ ...this.eventBus.nextEventBase(), result }));
			this.setRecordStatus(record, "ready");
			return result;
		} catch (error) {
			if (record.treeNavigationCancelling) {
				this.setRecordStatus(record, "ready");
				throw new SessionTreeNavigationFailed({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					targetEntryId: request.targetEntryId,
					message: "Tree navigation was cancelled",
					cause: getErrorMessage(error),
				});
			}
			const guiError =
				error instanceof SessionTreeNavigationFailed
					? error
					: new SessionTreeNavigationFailed({
							workspaceId: request.workspaceId,
							sessionId: request.sessionId,
							targetEntryId: request.targetEntryId,
							message: "Failed to navigate Pi session tree",
							cause: getErrorMessage(error),
						});
			this.eventBus.publish(
				new TreeNavigationFailed({
					...this.eventBus.nextEventBase(),
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					targetEntryId: request.targetEntryId,
					error: guiError,
				}),
			);
			this.setRecordStatus(record, "ready");
			throw guiError;
		} finally {
			record.treeNavigationActive = false;
			record.treeNavigationCancelling = false;
		}
	}

	async compact(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		customInstructions: string | undefined,
	): Promise<SessionCompactionSnapshot> {
		const record = this.getRecord(workspaceId, sessionId);
		if (record.activeRunId) {
			throw new SessionCompactFailed({
				workspaceId,
				sessionId,
				message: "Manual compaction is unavailable while a prompt run is active",
			});
		}
		this.eventBus.publish(
			new CompactionStarted({ ...this.eventBus.nextEventBase(), workspaceId, sessionId, reason: "manual" }),
		);
		this.setRecordStatus(record, "compacting");
		record.manualCompactionActive = true;
		record.manualCompactionCancelling = false;
		try {
			const result = await this.driver.compact(record.handle, customInstructions);
			this.publishTree(result.tree);
			this.eventBus.publish(new CompactionCompleted({ ...this.eventBus.nextEventBase(), result }));
			this.setRecordStatus(record, "ready");
			return result;
		} catch (error) {
			if (record.manualCompactionCancelling) {
				this.setRecordStatus(record, "ready");
				throw new SessionCompactFailed({
					workspaceId,
					sessionId,
					message: "Manual compaction was cancelled",
					cause: getErrorMessage(error),
				});
			}
			const guiError =
				error instanceof SessionCompactFailed
					? error
					: new SessionCompactFailed({
							workspaceId,
							sessionId,
							message: "Failed to compact Pi session",
							cause: getErrorMessage(error),
						});
			this.eventBus.publish(
				new CompactionFailed({ ...this.eventBus.nextEventBase(), workspaceId, sessionId, error: guiError }),
			);
			this.setRecordStatus(record, "ready");
			throw guiError;
		} finally {
			record.manualCompactionActive = false;
			record.manualCompactionCancelling = false;
		}
	}

	async exportSession(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		format: "html" | "jsonl",
		outputPath: string | undefined,
	): Promise<SessionExportSnapshot> {
		const record = this.getRecord(workspaceId, sessionId);
		return exportReadySession(this.driver, this.artifactService, record, format, outputPath);
	}

	async cancelCompaction(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
		const record = this.getRecord(workspaceId, sessionId);
		record.manualCompactionCancelling = true;
		this.setRecordStatus(record, "cancelling");
		try {
			await this.driver.cancelCompaction(record.handle);
		} catch (error) {
			record.manualCompactionCancelling = false;
			this.setRecordStatus(record, record.manualCompactionActive ? "compacting" : "ready");
			throw new SessionCancelFailed({
				workspaceId,
				sessionId,
				message: "Failed to cancel Pi session compaction",
				cause: getErrorMessage(error),
			});
		}
		this.eventBus.publish(new CompactionCancelled({ ...this.eventBus.nextEventBase(), workspaceId, sessionId }));
		this.setRecordStatus(record, "ready");
	}

	async cancelTreeNavigation(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
		const record = this.getRecord(workspaceId, sessionId);
		record.treeNavigationCancelling = true;
		this.setRecordStatus(record, "cancelling");
		try {
			await this.driver.cancelTreeNavigation(record.handle);
		} catch (error) {
			record.treeNavigationCancelling = false;
			this.setRecordStatus(record, record.treeNavigationActive ? "navigating" : "ready");
			throw new SessionCancelFailed({
				workspaceId,
				sessionId,
				message: "Failed to cancel Pi session tree navigation",
				cause: getErrorMessage(error),
			});
		}
	}

	async getSlashCommands(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SlashCommandSnapshot[]> {
		const getSlashCommands = this.driver.getSlashCommands;
		if (!getSlashCommands) return [];
		return getSlashCommands(this.getRecord(workspaceId, sessionId).handle);
	}

	async getResourceInventory(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ResourceInventorySnapshot> {
		const getResourceInventory = this.driver.getResourceInventory;
		if (!getResourceInventory) {
			throw new ResourceInventoryReadFailed({
				workspaceId,
				sessionId,
				message: "Pi GUI session driver does not expose resource inventory",
			});
		}
		const inventory = await getResourceInventory(this.getRecord(workspaceId, sessionId).handle);
		this.publishResourceInventory(inventory);
		return inventory;
	}

	async reloadResources(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ResourceInventorySnapshot> {
		const reloadResources = this.driver.reloadResources;
		if (!reloadResources) {
			throw new ResourceReloadFailed({
				workspaceId,
				sessionId,
				message: "Pi GUI session driver does not expose resource reload",
			});
		}
		const record = this.getRecord(workspaceId, sessionId);
		if (record.activeRunId || record.manualCompactionActive || record.treeNavigationActive) {
			throw new ResourceReloadFailed({
				workspaceId,
				sessionId,
				message: "Resource reload is unavailable while the Pi session is busy",
			});
		}
		this.setRecordStatus(record, "replacing");
		try {
			const inventory = await reloadResources(record.handle);
			this.publishResourceInventory(inventory);
			this.publishModelThinking(await this.driver.getModelThinking(record.handle));
			this.setRecordStatus(record, "ready");
			return inventory;
		} catch (error) {
			this.setRecordStatus(record, "ready");
			if (error instanceof ResourceReloadFailed) throw error;
			throw new ResourceReloadFailed({
				workspaceId,
				sessionId,
				message: "Failed to reload Pi session resources",
				cause: getErrorMessage(error),
			});
		}
	}

	async reloadWorkspaceResources(workspaceId: WorkspaceId): Promise<ResourceInventorySnapshot[]> {
		const records = Array.from(this.records.values()).filter((record) => record.handle.workspaceId === workspaceId);
		return Promise.all(records.map((record) => this.reloadResources(workspaceId, record.handle.sessionId)));
	}

	async restoreQueuedMessages(workspaceId: WorkspaceId, sessionId: SessionId): Promise<QueueRestoreSnapshot> {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const record = this.records.get(key);
		if (!record) {
			throw new SessionRuntimeNotOpen({
				workspaceId,
				sessionId,
				message: `Session runtime ${key} is not open`,
			});
		}
		const restored = await this.driver.restoreQueuedMessages(record.handle);
		record.queueSnapshot = restored.queue;
		return restored;
	}

	async getModelThinking(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ModelThinkingSnapshot> {
		const snapshot = await this.driver.getModelThinking(this.getRecord(workspaceId, sessionId).handle);
		this.publishModelThinking(snapshot);
		return snapshot;
	}

	async setModel(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		provider: string,
		modelId: string,
	): Promise<ModelThinkingSnapshot> {
		const snapshot = await this.driver.setModel(this.getRecord(workspaceId, sessionId).handle, provider, modelId);
		this.publishModelThinking(snapshot);
		return snapshot;
	}

	async setThinkingLevel(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		thinkingLevel: ThinkingLevel,
	): Promise<ModelThinkingSnapshot> {
		const snapshot = await this.driver.setThinkingLevel(this.getRecord(workspaceId, sessionId).handle, thinkingLevel);
		this.publishModelThinking(snapshot);
		return snapshot;
	}

	respondToExtensionUi(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		extensionUiRequestId: ExtensionUiRequestId;
		response: ExtensionUiResponse;
	}): void {
		if (!this.extensionHostUiService) {
			throw new SessionRuntimeNotFound({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				message: "Extension UI service is not available",
			});
		}
		this.extensionHostUiService.respond(request);
	}

	updateExtensionEditorText(workspaceId: WorkspaceId, sessionId: SessionId, text: string): void {
		if (!this.extensionHostUiService) {
			throw new SessionRuntimeNotFound({
				workspaceId,
				sessionId,
				message: "Extension UI service is not available",
			});
		}
		this.extensionHostUiService.updateEditorText(workspaceId, sessionId, text);
	}

	private getRecord(workspaceId: WorkspaceId, sessionId: SessionId): ManagedSessionRecord {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const record = this.records.get(key);
		if (record) return record;
		throw new SessionRuntimeNotFound({
			workspaceId,
			sessionId,
			message: `Session runtime ${key} is not open`,
		});
	}

	private async openRuntimeForSession(session: SessionSnapshot): Promise<void> {
		const key = createRuntimeSessionKey(session.workspaceId, session.id);
		if (this.records.has(key)) {
			return;
		}
		if (this.records.size >= this.maxOpenSessions) {
			throw new SessionOpenLimitReached({
				workspaceId: session.workspaceId,
				sessionId: session.id,
				maxOpenSessions: this.maxOpenSessions,
				message: `Pi GUI can keep at most ${this.maxOpenSessions} runtime sessions open`,
			});
		}
		if (!session.sessionFilePath) {
			throw new SessionFileMissing({
				sessionId: session.id,
				path: "",
				message: `Session ${session.id} has no file path`,
			});
		}

		this.publishStatus(session, "opening");
		try {
			const workspacePath = await this.getWorkspacePath(session.workspaceId);
			const handle = await this.driver.openSession({
				sessionFilePath: session.sessionFilePath,
				workspaceId: session.workspaceId,
				workspacePath,
			});
			const readySession = withStatus(session, "ready");
			const unsubscribe = this.driver.subscribe(handle, (event) => this.handleRuntimeEvent(key, event));
			const queueSnapshot = await this.driver.getQueue(handle);
			this.records.set(key, {
				handle,
				lastActivitySequence: 0,
				manualCompactionActive: false,
				manualCompactionCancelling: false,
				needsInput: false,
				queueSnapshot,
				session: readySession,
				treeNavigationActive: false,
				treeNavigationCancelling: false,
				unsubscribe,
			});
			this.eventBus.publish(new SessionOpened({ ...this.eventBus.nextEventBase(), session: readySession }));
			this.publishModelThinking(await this.driver.getModelThinking(handle));
			this.publishStatus(session, "ready");
		} catch (error) {
			this.publishStatus(session, "failed");
			throw error;
		}
	}

	private async getWorkspacePath(workspaceId: WorkspaceId): Promise<string> {
		const catalog = await this.catalogService.getWorkspaceCatalog();
		const workspace = catalog.workspaces.find((entry) => entry.id === workspaceId);
		if (!workspace) {
			throw new WorkspaceNotFound({
				workspaceId,
				message: `Workspace ${workspaceId} is not in the GUI catalog`,
			});
		}
		return workspace.path;
	}

	private publishStatus(session: SessionSnapshot, status: SessionSnapshot["status"]): void {
		this.eventBus.publish(
			new SessionStatusChanged({
				...this.eventBus.nextEventBase(),
				session: withStatus(session, status),
			}),
		);
	}

	private setRecordStatus(record: ManagedSessionRecord, status: SessionSnapshot["status"]): void {
		record.session = withStatus(record.session, status);
		this.eventBus.publish(
			new SessionStatusChanged({
				...this.eventBus.nextEventBase(),
				session: record.session,
			}),
		);
	}

	private publishAcceptedReceipt(requestId: RequestId): void {
		this.eventBus.publish(
			new ReceiptEmitted({
				...this.eventBus.nextEventBase(),
				receipt: "session.sendMessage.accepted",
				requestId,
			}),
		);
	}

	private publishModelThinking(snapshot: ModelThinkingSnapshot): void {
		this.eventBus.publish(new ModelThinkingUpdated({ ...this.eventBus.nextEventBase(), snapshot }));
	}

	private publishTree(tree: SessionTreeSnapshot): void {
		this.eventBus.publish(new TreeUpdated({ ...this.eventBus.nextEventBase(), tree }));
	}

	private publishResourceInventory(inventory: ResourceInventorySnapshot): void {
		this.eventBus.publish(new ResourcesInventoryUpdated({ ...this.eventBus.nextEventBase(), inventory }));
	}

	private async completeRuntimeCompaction(
		record: ManagedSessionRecord,
		event: Extract<RuntimeSessionEvent, { type: "compaction_end" }>,
	): Promise<void> {
		const { sessionId, workspaceId } = record.handle;
		if (event.aborted) {
			this.eventBus.publish(new CompactionCancelled({ ...this.eventBus.nextEventBase(), workspaceId, sessionId }));
			this.setRecordStatus(record, "ready");
			return;
		}
		if (event.errorMessage) {
			this.eventBus.publish(
				new CompactionFailed({
					...this.eventBus.nextEventBase(),
					workspaceId,
					sessionId,
					error: new SessionCompactFailed({
						workspaceId,
						sessionId,
						message: "Pi session compaction failed",
						cause: event.errorMessage,
					}),
				}),
			);
			this.setRecordStatus(record, "ready");
			return;
		}
		const timeline = await this.driver.getTranscript(record.handle);
		const tree = await this.driver.getTree(record.handle);
		const result: SessionCompactionSnapshot = {
			workspaceId,
			sessionId,
			...(event.result?.summary ? { summary: event.result.summary } : {}),
			...(event.result?.firstKeptEntryId ? { firstKeptEntryId: event.result.firstKeptEntryId } : {}),
			...(typeof event.result?.tokensBefore === "number" ? { tokensBefore: event.result.tokensBefore } : {}),
			timeline,
			tree,
			cancelled: false,
		};
		this.publishTree(tree);
		this.eventBus.publish(new CompactionCompleted({ ...this.eventBus.nextEventBase(), result }));
		this.setRecordStatus(record, "ready");
	}

	private failRuntimeCompaction(record: ManagedSessionRecord, error: unknown): void {
		const { sessionId, workspaceId } = record.handle;
		this.eventBus.publish(
			new CompactionFailed({
				...this.eventBus.nextEventBase(),
				workspaceId,
				sessionId,
				error: new SessionCompactFailed({
					workspaceId,
					sessionId,
					message: "Failed to refresh compacted Pi session",
					cause: getErrorMessage(error),
				}),
			}),
		);
		this.setRecordStatus(record, "ready");
	}

	private handleRuntimeEvent(key: RuntimeSessionKey, event: RuntimeSessionEvent): void {
		const record = this.records.get(key);
		if (!record) return;
		const runId = record.activeRunId;
		if (event.type === "compaction_start") {
			if (record.manualCompactionActive) return;
			this.eventBus.publish(
				new CompactionStarted({
					...this.eventBus.nextEventBase(),
					workspaceId: record.handle.workspaceId,
					sessionId: record.handle.sessionId,
					reason: "reason" in event && typeof event.reason === "string" ? event.reason : undefined,
				}),
			);
			this.setRecordStatus(record, "compacting");
			return;
		}
		if (event.type === "compaction_end") {
			if (record.manualCompactionActive) return;
			void this.completeRuntimeCompaction(record, event).catch((error: unknown) => {
				this.failRuntimeCompaction(record, error);
			});
			return;
		}
		if (event.type === "queue_update") {
			const queue = projectQueueSnapshot(record.handle, event, {
				steeringMode: record.handle.runtime.session.steeringMode,
				followUpMode: record.handle.runtime.session.followUpMode,
			});
			record.queueSnapshot = queue;
			this.publishQueue(record, queue);
			return;
		}
		if (event.type === "thinking_level_changed") {
			void this.getModelThinking(record.handle.workspaceId, record.handle.sessionId).catch(() => undefined);
			return;
		}
		if (!runId) return;
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			this.eventBus.publish(
				new TimelineMessageDelta({
					...this.eventBus.nextEventBase(),
					runId,
					workspaceId: record.handle.workspaceId,
					sessionId: record.handle.sessionId,
					text: event.assistantMessageEvent.delta,
				}),
			);
			return;
		}
		if (event.type === "tool_execution_start") {
			this.eventBus.publish(
				new ToolStarted({
					...this.eventBus.nextEventBase(),
					runId,
					workspaceId: record.handle.workspaceId,
					sessionId: record.handle.sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
				}),
			);
			return;
		}
		if (event.type === "tool_execution_update") {
			this.eventBus.publish(
				new ToolUpdated({
					...this.eventBus.nextEventBase(),
					runId,
					workspaceId: record.handle.workspaceId,
					sessionId: record.handle.sessionId,
					toolCallId: event.toolCallId,
					text: stringifyEventValue(event.partialResult),
				}),
			);
			return;
		}
		if (event.type === "tool_execution_end") {
			this.eventBus.publish(
				new ToolFinished({
					...this.eventBus.nextEventBase(),
					runId,
					workspaceId: record.handle.workspaceId,
					sessionId: record.handle.sessionId,
					toolCallId: event.toolCallId,
					isError: event.isError,
				}),
			);
		}
	}

	private async completeRun(record: ManagedSessionRecord, runId: RunId): Promise<void> {
		if (record.activeRunId !== runId) return;
		const timeline = await this.driver.getTranscript(record.handle);
		record.activeRunId = undefined;
		this.eventBus.publish(
			new RunCompleted({
				...this.eventBus.nextEventBase(),
				runId,
				workspaceId: record.handle.workspaceId,
				sessionId: record.handle.sessionId,
				timeline,
			}),
		);
		this.setRecordStatus(record, "ready");
	}

	private failRun(record: ManagedSessionRecord, runId: RunId, error: unknown): void {
		if (record.activeRunId !== runId) return;
		record.activeRunId = undefined;
		this.eventBus.publish(
			new RunFailed({
				...this.eventBus.nextEventBase(),
				runId,
				workspaceId: record.handle.workspaceId,
				sessionId: record.handle.sessionId,
				error: new SessionPromptFailed({
					workspaceId: record.handle.workspaceId,
					sessionId: record.handle.sessionId,
					runId,
					message: "Pi prompt failed after the run started",
					cause: getErrorMessage(error),
				}),
			}),
		);
		this.setRecordStatus(record, "failed");
	}

	private createRunId(workspaceId: WorkspaceId, sessionId: SessionId): RunId {
		this.runSequence += 1;
		return runIdFromString(`${workspaceId}:${sessionId}:run-${this.runSequence}`);
	}

	private assertCanOpenNewRuntime(workspaceId: WorkspaceId, sessionId?: SessionId): void {
		if (this.records.size < this.maxOpenSessions) return;
		throw new SessionOpenLimitReached({
			workspaceId,
			...(sessionId ? { sessionId } : {}),
			maxOpenSessions: this.maxOpenSessions,
			message: `Pi GUI can keep at most ${this.maxOpenSessions} runtime sessions open`,
		});
	}

	private publishQueue(record: ManagedSessionRecord, queue: QueueSnapshot): void {
		const event = new QueueUpdated({
			...this.eventBus.nextEventBase(),
			workspaceId: record.handle.workspaceId,
			sessionId: record.handle.sessionId,
			steeringCount: queue.steeringCount,
			followUpCount: queue.followUpCount,
			steeringMessages: queue.steeringMessages,
			followUpMessages: queue.followUpMessages,
			steeringMode: queue.steeringMode,
			followUpMode: queue.followUpMode,
			queue,
		});
		this.eventBus.publish(event);
		record.lastActivitySequence = event.sequence;
		this.publishActivity(record);
	}

	private publishActivity(record: ManagedSessionRecord): void {
		this.eventBus.publish(
			new SessionActivityUpdated({
				...this.eventBus.nextEventBase(),
				activity: this.activitySnapshot(record),
			}),
		);
	}

	private activitySnapshot(record: ManagedSessionRecord) {
		return {
			workspaceId: record.handle.workspaceId,
			sessionId: record.handle.sessionId,
			hasUnread: false,
			needsInput: record.needsInput,
			queueCount: record.queueSnapshot.steeringCount + record.queueSnapshot.followUpCount,
			lastActivitySequence: record.lastActivitySequence,
		};
	}

	private async consumeImages(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		attachmentIds: readonly string[] | undefined,
	) {
		return consumeSessionImages(this.imageAttachmentService, workspaceId, sessionId, attachmentIds);
	}
}
