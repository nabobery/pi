import {
	ModelThinkingUpdated,
	QueueUpdated,
	ReceiptEmitted,
	RunCancelled,
	RunCompleted,
	RunFailed,
	RunStarted,
	SessionCancelFailed,
	SessionClosed,
	SessionFileMissing,
	SessionActivityUpdated,
	SessionOpenLimitReached,
	SessionOpened,
	SessionPromptFailed,
	SessionRuntimeNotOpen,
	SessionRuntimeNotFound,
	SessionRunNotActive,
	SessionStatusChanged,
	TimelineMessageDelta,
	ToolFinished,
	ToolStarted,
	ToolUpdated,
	WorkspaceNotFound,
	type GuiEvent,
	type ExtensionUiRequestId,
	type ModelThinkingSnapshot,
	type QueueSnapshot,
	type QueueRestoreSnapshot,
	type RequestId,
	type RunId,
	type SessionCatalogSnapshot,
	type SessionId,
	type SessionSnapshot,
	type SlashCommandSnapshot,
	type TimelineSnapshot,
	type ThinkingLevel,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
	runIdFromString,
} from "../../contracts/index.ts";
import { projectQueueSnapshot } from "./queue-projection.ts";
import { createRuntimeSessionKey, type RuntimeSessionKey } from "./session-key.ts";
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
	maxOpenSessions?: number;
}

interface ManagedSessionRecord {
	activeRunId?: RunId;
	handle: RuntimeSessionHandle;
	lastActivitySequence: number;
	needsInput: boolean;
	queueSnapshot: QueueSnapshot;
	session: SessionSnapshot;
	unsubscribe: () => void;
}

export class SessionSupervisor {
	private readonly catalogService: SessionCatalogRuntimeService;
	private readonly driver: SessionDriver;
	private readonly eventBus: SessionSupervisorEventBus;
	private readonly extensionHostUiService: SessionSupervisorOptions["extensionHostUiService"];
	private readonly maxOpenSessions: number;
	private readonly records = new Map<RuntimeSessionKey, ManagedSessionRecord>();
	private runSequence = 0;

	constructor(options: SessionSupervisorOptions) {
		this.catalogService = options.catalogService;
		this.driver = options.driver;
		this.eventBus = options.eventBus;
		this.extensionHostUiService = options.extensionHostUiService;
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
	}): Promise<void> {
		const record = this.getRecord(request.workspaceId, request.sessionId);
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
			});
			this.publishAcceptedReceipt(request.requestId);
			return;
		}

		const result = await this.driver.sendMessage(record.handle, {
			message: request.message,
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

	async getSlashCommands(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SlashCommandSnapshot[]> {
		const getSlashCommands = this.driver.getSlashCommands;
		if (!getSlashCommands) return [];
		return getSlashCommands(this.getRecord(workspaceId, sessionId).handle);
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
				needsInput: false,
				queueSnapshot,
				session: readySession,
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

	private handleRuntimeEvent(key: RuntimeSessionKey, event: RuntimeSessionEvent): void {
		const record = this.records.get(key);
		if (!record) return;
		const runId = record.activeRunId;
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
}

function findSelectedSession(catalog: SessionCatalogSnapshot): SessionSnapshot {
	const selectedSessionId = catalog.selectedSessionId ?? catalog.sessions[0]?.id;
	if (selectedSessionId) return findSession(catalog, selectedSessionId);
	throw new SessionFileMissing({ sessionId: "", path: "", message: "Created session was not returned by catalog" });
}

function findSession(catalog: SessionCatalogSnapshot, sessionId: SessionId): SessionSnapshot {
	const session = catalog.sessions.find((entry) => entry.id === sessionId);
	if (session) return session;
	throw new SessionRuntimeNotFound({
		workspaceId: catalog.workspaceId,
		sessionId,
		message: `Session ${sessionId} was not returned by catalog`,
	});
}

function withStatus(session: SessionSnapshot, status: SessionSnapshot["status"]): SessionSnapshot {
	return { ...session, status };
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function stringifyEventValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
