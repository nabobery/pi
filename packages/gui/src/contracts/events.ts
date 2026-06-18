import { Effect, Schema } from "effect";
import { GuiError } from "./errors.ts";
import { EventId, RequestId, RunId, SessionId, WorkspaceId } from "./ids.ts";
import {
	ExtensionUiRequestSnapshot,
	ExtensionUiStateSnapshot,
	ModelThinkingSnapshot,
	SessionCatalogSnapshot,
	SessionSnapshot,
	SettingsSummarySnapshot,
	TimelineSnapshot,
	TrustStatusSnapshot,
	WorkspaceCatalogSnapshot,
} from "./snapshots.ts";

const EventBaseFields = {
	eventId: EventId,
	sequence: Schema.Number,
};

export class AppReady extends Schema.TaggedClass<AppReady>()("app.ready", {
	...EventBaseFields,
}) {}

export class AppError extends Schema.TaggedClass<AppError>()("app.error", {
	...EventBaseFields,
	error: GuiError,
}) {}

export class ReceiptEmitted extends Schema.TaggedClass<ReceiptEmitted>()("receipt.emitted", {
	...EventBaseFields,
	receipt: Schema.String,
	requestId: RequestId,
}) {}

export class WorkspaceCatalogUpdated extends Schema.TaggedClass<WorkspaceCatalogUpdated>()("workspace.catalogUpdated", {
	...EventBaseFields,
	catalog: WorkspaceCatalogSnapshot,
}) {}

export class WorkspaceSynced extends Schema.TaggedClass<WorkspaceSynced>()("workspace.synced", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	sessions: SessionCatalogSnapshot,
}) {}

export class SessionCatalogUpdated extends Schema.TaggedClass<SessionCatalogUpdated>()("session.catalogUpdated", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	sessions: Schema.Array(SessionSnapshot),
}) {}

export class SessionSelected extends Schema.TaggedClass<SessionSelected>()("session.selected", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
}) {}

export class SessionOpened extends Schema.TaggedClass<SessionOpened>()("session.opened", {
	...EventBaseFields,
	session: SessionSnapshot,
}) {}

export class SessionClosed extends Schema.TaggedClass<SessionClosed>()("session.closed", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
}) {}

export class SessionStatusChanged extends Schema.TaggedClass<SessionStatusChanged>()("session.statusChanged", {
	...EventBaseFields,
	session: SessionSnapshot,
}) {}

export class TimelineMessageDelta extends Schema.TaggedClass<TimelineMessageDelta>()("timeline.messageDelta", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	runId: RunId,
	sessionId: SessionId,
	text: Schema.String,
}) {}

export class ToolStarted extends Schema.TaggedClass<ToolStarted>()("tool.started", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	runId: RunId,
	sessionId: SessionId,
	toolCallId: Schema.String,
	toolName: Schema.String,
}) {}

export class ToolUpdated extends Schema.TaggedClass<ToolUpdated>()("tool.updated", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	runId: RunId,
	sessionId: SessionId,
	toolCallId: Schema.String,
	text: Schema.String,
}) {}

export class ToolFinished extends Schema.TaggedClass<ToolFinished>()("tool.finished", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	runId: RunId,
	sessionId: SessionId,
	toolCallId: Schema.String,
	isError: Schema.Boolean,
}) {}

export class QueueUpdated extends Schema.TaggedClass<QueueUpdated>()("queue.updated", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	steeringCount: Schema.Number,
	followUpCount: Schema.Number,
}) {}

export class RunStarted extends Schema.TaggedClass<RunStarted>()("run.started", {
	...EventBaseFields,
	runId: RunId,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
}) {}

export class RunCompleted extends Schema.TaggedClass<RunCompleted>()("run.completed", {
	...EventBaseFields,
	runId: RunId,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	timeline: Schema.optional(TimelineSnapshot),
}) {}

export class RunFailed extends Schema.TaggedClass<RunFailed>()("run.failed", {
	...EventBaseFields,
	runId: RunId,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	error: GuiError,
}) {}

export class RunCancelled extends Schema.TaggedClass<RunCancelled>()("run.cancelled", {
	...EventBaseFields,
	runId: RunId,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
}) {}

export class ModelThinkingUpdated extends Schema.TaggedClass<ModelThinkingUpdated>()("modelThinking.updated", {
	...EventBaseFields,
	snapshot: ModelThinkingSnapshot,
}) {}

export class SettingsSummaryUpdated extends Schema.TaggedClass<SettingsSummaryUpdated>()("settings.summaryUpdated", {
	...EventBaseFields,
	summary: SettingsSummarySnapshot,
}) {}

export class TrustStatusUpdated extends Schema.TaggedClass<TrustStatusUpdated>()("trust.statusUpdated", {
	...EventBaseFields,
	status: TrustStatusSnapshot,
}) {}

export class ExtensionUiRequested extends Schema.TaggedClass<ExtensionUiRequested>()("extensionUi.requested", {
	...EventBaseFields,
	request: ExtensionUiRequestSnapshot,
}) {}

export class ExtensionUiResolved extends Schema.TaggedClass<ExtensionUiResolved>()("extensionUi.resolved", {
	...EventBaseFields,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	extensionUiRequestId: Schema.String,
	requestId: Schema.optional(RequestId),
}) {}

export class ExtensionUiUpdated extends Schema.TaggedClass<ExtensionUiUpdated>()("extensionUi.updated", {
	...EventBaseFields,
	update: ExtensionUiStateSnapshot,
}) {}

export class ExtensionUiCompatibilityIssue extends Schema.TaggedClass<ExtensionUiCompatibilityIssue>()(
	"extensionUi.compatibilityIssue",
	{
		...EventBaseFields,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		method: Schema.String,
		message: Schema.String,
	},
) {}

export const GuiEvent = Schema.Union(
	AppReady,
	AppError,
	ReceiptEmitted,
	WorkspaceCatalogUpdated,
	WorkspaceSynced,
	SessionCatalogUpdated,
	SessionSelected,
	SessionOpened,
	SessionClosed,
	SessionStatusChanged,
	TimelineMessageDelta,
	ToolStarted,
	ToolUpdated,
	ToolFinished,
	QueueUpdated,
	RunStarted,
	RunCompleted,
	RunFailed,
	RunCancelled,
	ModelThinkingUpdated,
	SettingsSummaryUpdated,
	TrustStatusUpdated,
	ExtensionUiRequested,
	ExtensionUiResolved,
	ExtensionUiUpdated,
	ExtensionUiCompatibilityIssue,
);
export type GuiEvent = Schema.Schema.Type<typeof GuiEvent>;

export const decodeGuiEvent = (value: unknown): Promise<GuiEvent> =>
	Effect.runPromise(Schema.decodeUnknown(GuiEvent)(value));
