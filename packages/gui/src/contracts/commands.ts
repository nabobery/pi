import { Effect, Schema } from "effect";
import { GuiError } from "./errors.ts";
import { ExtensionUiRequestId, RequestId, SessionId, WorkspaceId } from "./ids.ts";
import {
	BootstrapSnapshot,
	ModelThinkingSnapshot,
	SessionCatalogSnapshot,
	SettingsSummarySnapshot,
	ThinkingLevel,
	TimelineSnapshot,
	TrustStatusSnapshot,
	WorkspaceCatalogSnapshot,
} from "./snapshots.ts";

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
	success: WorkspaceCatalogSnapshot,
	payload: { requestId: RequestId, path: Schema.String },
}) {}

export class WorkspacePickDirectory extends Schema.TaggedRequest<WorkspacePickDirectory>()("workspace.pickDirectory", {
	failure: GuiError,
	success: WorkspaceCatalogSnapshot,
	payload: { requestId: RequestId },
}) {}

export class WorkspaceSelect extends Schema.TaggedRequest<WorkspaceSelect>()("workspace.select", {
	failure: GuiError,
	success: WorkspaceCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class WorkspaceSync extends Schema.TaggedRequest<WorkspaceSync>()("workspace.sync", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class WorkspaceRemove extends Schema.TaggedRequest<WorkspaceRemove>()("workspace.remove", {
	failure: GuiError,
	success: WorkspaceCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class SessionCreate extends Schema.TaggedRequest<SessionCreate>()("session.create", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class SessionOpen extends Schema.TaggedRequest<SessionOpen>()("session.open", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionRename extends Schema.TaggedRequest<SessionRename>()("session.rename", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId, title: Schema.String },
}) {}

export class SessionArchive extends Schema.TaggedRequest<SessionArchive>()("session.archive", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionUnarchive extends Schema.TaggedRequest<SessionUnarchive>()("session.unarchive", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionClose extends Schema.TaggedRequest<SessionClose>()("session.close", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionSendMessage extends Schema.TaggedRequest<SessionSendMessage>()("session.sendMessage", {
	failure: GuiError,
	success: VoidSuccess,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		message: Schema.String,
		deliveryMode: Schema.optional(Schema.Literal("steer", "followUp")),
	},
}) {}

export class SessionCancelRun extends Schema.TaggedRequest<SessionCancelRun>()("session.cancelRun", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionSetModel extends Schema.TaggedRequest<SessionSetModel>()("session.setModel", {
	failure: GuiError,
	success: ModelThinkingSnapshot,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		provider: Schema.String,
		modelId: Schema.String,
	},
}) {}

export class SessionSetThinkingLevel extends Schema.TaggedRequest<SessionSetThinkingLevel>()(
	"session.setThinkingLevel",
	{
		failure: GuiError,
		success: ModelThinkingSnapshot,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId, thinkingLevel: ThinkingLevel },
	},
) {}

export class SessionGetTranscript extends Schema.TaggedRequest<SessionGetTranscript>()("session.getTranscript", {
	failure: GuiError,
	success: TimelineSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class ExtensionUiRespond extends Schema.TaggedRequest<ExtensionUiRespond>()("extensionUi.respond", {
	failure: GuiError,
	success: VoidSuccess,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		extensionUiRequestId: ExtensionUiRequestId,
		response: Schema.Union(
			Schema.Struct({ kind: Schema.Literal("confirm"), confirmed: Schema.Boolean }),
			Schema.Struct({
				kind: Schema.Literal("input"),
				value: Schema.optional(Schema.String),
				cancelled: Schema.Boolean,
			}),
			Schema.Struct({
				kind: Schema.Literal("select"),
				value: Schema.optional(Schema.String),
				cancelled: Schema.Boolean,
			}),
			Schema.Struct({
				kind: Schema.Literal("editor"),
				value: Schema.optional(Schema.String),
				cancelled: Schema.Boolean,
			}),
			Schema.Struct({ kind: Schema.Literal("getEditorText"), value: Schema.String }),
		),
	},
}) {}

export class ExtensionUiUpdateEditorText extends Schema.TaggedRequest<ExtensionUiUpdateEditorText>()(
	"extensionUi.updateEditorText",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: {
			requestId: RequestId,
			workspaceId: WorkspaceId,
			sessionId: SessionId,
			text: Schema.String,
		},
	},
) {}

export class SettingsGetSummary extends Schema.TaggedRequest<SettingsGetSummary>()("settings.getSummary", {
	failure: GuiError,
	success: SettingsSummarySnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class SettingsOpenGlobalFile extends Schema.TaggedRequest<SettingsOpenGlobalFile>()("settings.openGlobalFile", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export class SettingsRevealGlobalFile extends Schema.TaggedRequest<SettingsRevealGlobalFile>()(
	"settings.revealGlobalFile",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: { requestId: RequestId, workspaceId: WorkspaceId },
	},
) {}

export class SettingsOpenProjectFile extends Schema.TaggedRequest<SettingsOpenProjectFile>()(
	"settings.openProjectFile",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: { requestId: RequestId, workspaceId: WorkspaceId },
	},
) {}

export class SettingsRevealProjectFile extends Schema.TaggedRequest<SettingsRevealProjectFile>()(
	"settings.revealProjectFile",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: { requestId: RequestId, workspaceId: WorkspaceId },
	},
) {}

export class TrustGetStatus extends Schema.TaggedRequest<TrustGetStatus>()("trust.getStatus", {
	failure: GuiError,
	success: TrustStatusSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId },
}) {}

export const GuiCommand = Schema.Union(
	AppBootstrap,
	RendererReady,
	WorkspaceAdd,
	WorkspacePickDirectory,
	WorkspaceSelect,
	WorkspaceSync,
	WorkspaceRemove,
	SessionCreate,
	SessionOpen,
	SessionRename,
	SessionArchive,
	SessionUnarchive,
	SessionClose,
	SessionSendMessage,
	SessionCancelRun,
	SessionSetModel,
	SessionSetThinkingLevel,
	SessionGetTranscript,
	ExtensionUiRespond,
	ExtensionUiUpdateEditorText,
	SettingsGetSummary,
	SettingsOpenGlobalFile,
	SettingsRevealGlobalFile,
	SettingsOpenProjectFile,
	SettingsRevealProjectFile,
	TrustGetStatus,
);
export type GuiCommand = Schema.Schema.Type<typeof GuiCommand>;

export const decodeGuiCommand = (value: unknown): Promise<GuiCommand> =>
	Effect.runPromise(Schema.decodeUnknown(GuiCommand)(value));
