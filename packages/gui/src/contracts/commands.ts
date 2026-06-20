import { Effect, Schema } from "effect";
import { GuiError } from "./errors.ts";
import { ExtensionUiRequestId, RequestId, SessionId, WorkspaceId } from "./ids.ts";
import {
	BootstrapSnapshot,
	CommonSettingsPatch,
	ImageAttachmentListSnapshot,
	ModelThinkingSnapshot,
	QueueRestoreSnapshot,
	ResourceInventorySnapshot,
	ResumeNameFilter,
	ResumeScope,
	ResumeSearchSnapshot,
	ResumeSortMode,
	SessionCompactionSnapshot,
	SessionCatalogSnapshot,
	SessionExportResultSnapshot,
	SessionShareSnapshot,
	SessionTreeSnapshot,
	SettingsEditorSnapshot,
	SettingsSummarySnapshot,
	SlashCommandCatalogSnapshot,
	ThinkingLevel,
	TimelineSnapshot,
	TreeNavigationSnapshot,
	TreeNavigationSummaryMode,
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
		attachmentIds: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
	},
}) {}

export class ComposerPickImages extends Schema.TaggedRequest<ComposerPickImages>()("composer.pickImages", {
	failure: GuiError,
	success: ImageAttachmentListSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class ComposerPasteImageFromClipboard extends Schema.TaggedRequest<ComposerPasteImageFromClipboard>()(
	"composer.pasteImageFromClipboard",
	{
		failure: GuiError,
		success: ImageAttachmentListSnapshot,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
	},
) {}

export class ComposerRemoveImageAttachment extends Schema.TaggedRequest<ComposerRemoveImageAttachment>()(
	"composer.removeImageAttachment",
	{
		failure: GuiError,
		success: ImageAttachmentListSnapshot,
		payload: {
			requestId: RequestId,
			workspaceId: WorkspaceId,
			sessionId: SessionId,
			attachmentId: Schema.NonEmptyTrimmedString,
		},
	},
) {}

export class ComposerClearImageAttachments extends Schema.TaggedRequest<ComposerClearImageAttachments>()(
	"composer.clearImageAttachments",
	{
		failure: GuiError,
		success: ImageAttachmentListSnapshot,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
	},
) {}

export class SessionCancelRun extends Schema.TaggedRequest<SessionCancelRun>()("session.cancelRun", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionExport extends Schema.TaggedRequest<SessionExport>()("session.export", {
	failure: GuiError,
	success: SessionExportResultSnapshot,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		format: Schema.Literal("html", "jsonl"),
		outputPath: Schema.optional(Schema.String),
	},
}) {}

export class SessionShare extends Schema.TaggedRequest<SessionShare>()("session.share", {
	failure: GuiError,
	success: SessionShareSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId, confirmed: Schema.Literal(true) },
}) {}

export class ArtifactOpen extends Schema.TaggedRequest<ArtifactOpen>()("artifact.open", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, artifactId: Schema.NonEmptyTrimmedString },
}) {}

export class ArtifactReveal extends Schema.TaggedRequest<ArtifactReveal>()("artifact.reveal", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, artifactId: Schema.NonEmptyTrimmedString },
}) {}

export class ArtifactOpenExternal extends Schema.TaggedRequest<ArtifactOpenExternal>()("artifact.openExternal", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, artifactId: Schema.NonEmptyTrimmedString },
}) {}

export class SessionRestoreQueuedMessages extends Schema.TaggedRequest<SessionRestoreQueuedMessages>()(
	"session.restoreQueuedMessages",
	{
		failure: GuiError,
		success: QueueRestoreSnapshot,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
	},
) {}

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

export class SessionGetSlashCommands extends Schema.TaggedRequest<SessionGetSlashCommands>()(
	"session.getSlashCommands",
	{
		failure: GuiError,
		success: SlashCommandCatalogSnapshot,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
	},
) {}

export class SessionGetTree extends Schema.TaggedRequest<SessionGetTree>()("session.getTree", {
	failure: GuiError,
	success: SessionTreeSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class SessionNavigateTree extends Schema.TaggedRequest<SessionNavigateTree>()("session.navigateTree", {
	failure: GuiError,
	success: TreeNavigationSnapshot,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		targetEntryId: Schema.String,
		summaryMode: TreeNavigationSummaryMode,
		customInstructions: Schema.optional(Schema.String),
		label: Schema.optional(Schema.String),
	},
}) {}

export class SessionSetTreeEntryLabel extends Schema.TaggedRequest<SessionSetTreeEntryLabel>()(
	"session.setTreeEntryLabel",
	{
		failure: GuiError,
		success: SessionTreeSnapshot,
		payload: {
			requestId: RequestId,
			workspaceId: WorkspaceId,
			sessionId: SessionId,
			entryId: Schema.String,
			label: Schema.optional(Schema.String),
		},
	},
) {}

export class SessionCompact extends Schema.TaggedRequest<SessionCompact>()("session.compact", {
	failure: GuiError,
	success: SessionCompactionSnapshot,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		customInstructions: Schema.optional(Schema.String),
	},
}) {}

export class SessionCancelCompaction extends Schema.TaggedRequest<SessionCancelCompaction>()(
	"session.cancelCompaction",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
	},
) {}

export class SessionCancelTreeNavigation extends Schema.TaggedRequest<SessionCancelTreeNavigation>()(
	"session.cancelTreeNavigation",
	{
		failure: GuiError,
		success: VoidSuccess,
		payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
	},
) {}

export class ResumeSearch extends Schema.TaggedRequest<ResumeSearch>()("resume.search", {
	failure: GuiError,
	success: ResumeSearchSnapshot,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		query: Schema.String,
		scope: ResumeScope,
		sortMode: ResumeSortMode,
		nameFilter: ResumeNameFilter,
		includeArchived: Schema.Boolean,
	},
}) {}

export class ResumeOpen extends Schema.TaggedRequest<ResumeOpen>()("resume.open", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class ResumeRename extends Schema.TaggedRequest<ResumeRename>()("resume.rename", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId, title: Schema.String },
}) {}

export class ResumeArchive extends Schema.TaggedRequest<ResumeArchive>()("resume.archive", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: SessionId },
}) {}

export class ResumeUnarchive extends Schema.TaggedRequest<ResumeUnarchive>()("resume.unarchive", {
	failure: GuiError,
	success: SessionCatalogSnapshot,
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

export class SettingsGetEditorSnapshot extends Schema.TaggedRequest<SettingsGetEditorSnapshot>()(
	"settings.getEditorSnapshot",
	{
		failure: GuiError,
		success: SettingsEditorSnapshot,
		payload: { requestId: RequestId, workspaceId: WorkspaceId },
	},
) {}

export class SettingsUpdateCommon extends Schema.TaggedRequest<SettingsUpdateCommon>()("settings.updateCommon", {
	failure: GuiError,
	success: SettingsEditorSnapshot,
	payload: {
		requestId: RequestId,
		workspaceId: WorkspaceId,
		scope: Schema.Literal("global"),
		patch: CommonSettingsPatch,
	},
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

export class TrustSaveDecision extends Schema.TaggedRequest<TrustSaveDecision>()("trust.saveDecision", {
	failure: GuiError,
	success: TrustStatusSnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, optionId: Schema.NonEmptyTrimmedString },
}) {}

export class ResourcesGetInventory extends Schema.TaggedRequest<ResourcesGetInventory>()("resources.getInventory", {
	failure: GuiError,
	success: ResourceInventorySnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: Schema.optional(SessionId) },
}) {}

export class ResourcesReload extends Schema.TaggedRequest<ResourcesReload>()("resources.reload", {
	failure: GuiError,
	success: ResourceInventorySnapshot,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, sessionId: Schema.optional(SessionId) },
}) {}

export class ResourcesOpenSource extends Schema.TaggedRequest<ResourcesOpenSource>()("resources.openSource", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, resourceId: Schema.NonEmptyTrimmedString },
}) {}

export class ResourcesRevealSource extends Schema.TaggedRequest<ResourcesRevealSource>()("resources.revealSource", {
	failure: GuiError,
	success: VoidSuccess,
	payload: { requestId: RequestId, workspaceId: WorkspaceId, resourceId: Schema.NonEmptyTrimmedString },
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
	ComposerPickImages,
	ComposerPasteImageFromClipboard,
	ComposerRemoveImageAttachment,
	ComposerClearImageAttachments,
	SessionCancelRun,
	SessionExport,
	SessionShare,
	ArtifactOpen,
	ArtifactReveal,
	ArtifactOpenExternal,
	SessionRestoreQueuedMessages,
	SessionSetModel,
	SessionSetThinkingLevel,
	SessionGetTranscript,
	SessionGetSlashCommands,
	SessionGetTree,
	SessionNavigateTree,
	SessionSetTreeEntryLabel,
	SessionCompact,
	SessionCancelCompaction,
	SessionCancelTreeNavigation,
	ResumeSearch,
	ResumeOpen,
	ResumeRename,
	ResumeArchive,
	ResumeUnarchive,
	ExtensionUiRespond,
	ExtensionUiUpdateEditorText,
	SettingsGetSummary,
	SettingsGetEditorSnapshot,
	SettingsUpdateCommon,
	SettingsOpenGlobalFile,
	SettingsRevealGlobalFile,
	SettingsOpenProjectFile,
	SettingsRevealProjectFile,
	TrustGetStatus,
	TrustSaveDecision,
	ResourcesGetInventory,
	ResourcesReload,
	ResourcesOpenSource,
	ResourcesRevealSource,
);
export type GuiCommand = Schema.Schema.Type<typeof GuiCommand>;

export const decodeGuiCommand = (value: unknown): Promise<GuiCommand> =>
	Effect.runPromise(Schema.decodeUnknown(GuiCommand)(value));
