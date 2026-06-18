import { Effect, Schema } from "effect";
import { GuiError } from "./errors.ts";
import { ExtensionUiRequestId, RequestId, SessionId, WorkspaceId } from "./ids.ts";
import { BootstrapSnapshot, TimelineSnapshot } from "./snapshots.ts";

const VoidSuccess = Schema.Void;

export class AppBootstrap extends Schema.TaggedRequest<AppBootstrap>()("app.bootstrap", {
	failure: GuiError,
	success: BootstrapSnapshot,
	payload: { requestId: RequestId },
}) {}

export class RendererReady extends Schema.TaggedRequest<RendererReady>()("app.rendererReady", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId },
}) {}

export class WorkspaceAdd extends Schema.TaggedRequest<WorkspaceAdd>()("workspace.add", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, path: Schema.String },
}) {}

export class WorkspaceSelect extends Schema.TaggedRequest<WorkspaceSelect>()("workspace.select", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class WorkspaceSync extends Schema.TaggedRequest<WorkspaceSync>()("workspace.sync", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class SessionCreate extends Schema.TaggedRequest<SessionCreate>()("session.create", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class SessionOpen extends Schema.TaggedRequest<SessionOpen>()("session.open", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, sessionId: SessionId },
}) {}

export class SessionClose extends Schema.TaggedRequest<SessionClose>()("session.close", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, sessionId: SessionId },
}) {}

export class SessionSendMessage extends Schema.TaggedRequest<SessionSendMessage>()("session.sendMessage", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, sessionId: SessionId, message: Schema.String },
}) {}

export class SessionCancelRun extends Schema.TaggedRequest<SessionCancelRun>()("session.cancelRun", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, sessionId: SessionId },
}) {}

export class SessionSetModel extends Schema.TaggedRequest<SessionSetModel>()("session.setModel", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, sessionId: SessionId, provider: Schema.String, modelId: Schema.String },
}) {}

export class SessionSetThinkingLevel extends Schema.TaggedRequest<SessionSetThinkingLevel>()(
	"session.setThinkingLevel",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: { requestId: RequestId, sessionId: SessionId, thinkingLevel: Schema.String },
	},
) {}

export class SessionGetTranscript extends Schema.TaggedRequest<SessionGetTranscript>()("session.getTranscript", {
	failure: GuiError,
	success: TimelineSnapshot,
	payload: { requestId: RequestId, sessionId: SessionId },
}) {}

export class ExtensionUiRespond extends Schema.TaggedRequest<ExtensionUiRespond>()("extensionUi.respond", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, extensionUiRequestId: ExtensionUiRequestId, value: Schema.Unknown },
}) {}

export const GuiCommand = Schema.Union(
	AppBootstrap,
	RendererReady,
	WorkspaceAdd,
	WorkspaceSelect,
	WorkspaceSync,
	SessionCreate,
	SessionOpen,
	SessionClose,
	SessionSendMessage,
	SessionCancelRun,
	SessionSetModel,
	SessionSetThinkingLevel,
	SessionGetTranscript,
	ExtensionUiRespond,
);
export type GuiCommand = Schema.Schema.Type<typeof GuiCommand>;

export const decodeGuiCommand = (value: unknown): Promise<GuiCommand> =>
	Effect.runPromise(Schema.decodeUnknown(GuiCommand)(value));
