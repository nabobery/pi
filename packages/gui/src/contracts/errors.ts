import { Effect, Schema } from "effect";

export class InvalidRendererCommand extends Schema.TaggedError<InvalidRendererCommand>()("InvalidRendererCommand", {
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class UnauthorizedIpcSender extends Schema.TaggedError<UnauthorizedIpcSender>()("UnauthorizedIpcSender", {
	message: Schema.String,
}) {}

export class CommandNotImplemented extends Schema.TaggedError<CommandNotImplemented>()("CommandNotImplemented", {
	commandTag: Schema.String,
	message: Schema.String,
}) {}

export class InternalIpcError extends Schema.TaggedError<InternalIpcError>()("InternalIpcError", {
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class InvalidWorkspacePath extends Schema.TaggedError<InvalidWorkspacePath>()("InvalidWorkspacePath", {
	path: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()("WorkspaceNotFound", {
	workspaceId: Schema.String,
	message: Schema.String,
}) {}

export class WorkspacePathMissing extends Schema.TaggedError<WorkspacePathMissing>()("WorkspacePathMissing", {
	workspaceId: Schema.String,
	path: Schema.String,
	message: Schema.String,
}) {}

export class CatalogReadFailed extends Schema.TaggedError<CatalogReadFailed>()("CatalogReadFailed", {
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class CatalogParseFailed extends Schema.TaggedError<CatalogParseFailed>()("CatalogParseFailed", {
	message: Schema.String,
	cause: Schema.optional(Schema.String),
	backupPath: Schema.optional(Schema.String),
}) {}

export class CatalogWriteFailed extends Schema.TaggedError<CatalogWriteFailed>()("CatalogWriteFailed", {
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", {
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class SessionFileMissing extends Schema.TaggedError<SessionFileMissing>()("SessionFileMissing", {
	sessionId: Schema.String,
	path: Schema.String,
	message: Schema.String,
}) {}

export class SessionSyncFailed extends Schema.TaggedError<SessionSyncFailed>()("SessionSyncFailed", {
	workspaceId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionCreateFailed extends Schema.TaggedError<SessionCreateFailed>()("SessionCreateFailed", {
	workspaceId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionRenameFailed extends Schema.TaggedError<SessionRenameFailed>()("SessionRenameFailed", {
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionRuntimeNotFound extends Schema.TaggedError<SessionRuntimeNotFound>()("SessionRuntimeNotFound", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class SessionRuntimeCreateFailed extends Schema.TaggedError<SessionRuntimeCreateFailed>()(
	"SessionRuntimeCreateFailed",
	{
		workspaceId: Schema.optional(Schema.String),
		sessionId: Schema.optional(Schema.String),
		sessionFilePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionRuntimeOpenFailed extends Schema.TaggedError<SessionRuntimeOpenFailed>()(
	"SessionRuntimeOpenFailed",
	{
		workspaceId: Schema.optional(Schema.String),
		sessionId: Schema.optional(Schema.String),
		sessionFilePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionRuntimeCloseFailed extends Schema.TaggedError<SessionRuntimeCloseFailed>()(
	"SessionRuntimeCloseFailed",
	{
		workspaceId: Schema.optional(Schema.String),
		sessionId: Schema.String,
		sessionFilePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionRuntimeBindFailed extends Schema.TaggedError<SessionRuntimeBindFailed>()(
	"SessionRuntimeBindFailed",
	{
		workspaceId: Schema.optional(Schema.String),
		sessionId: Schema.String,
		sessionFilePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionAlreadyOpen extends Schema.TaggedError<SessionAlreadyOpen>()("SessionAlreadyOpen", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class SessionOpenLimitReached extends Schema.TaggedError<SessionOpenLimitReached>()("SessionOpenLimitReached", {
	workspaceId: Schema.String,
	sessionId: Schema.optional(Schema.String),
	maxOpenSessions: Schema.Number,
	message: Schema.String,
}) {}

export class SessionRuntimeNotOpen extends Schema.TaggedError<SessionRuntimeNotOpen>()("SessionRuntimeNotOpen", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class SessionTranscriptReadFailed extends Schema.TaggedError<SessionTranscriptReadFailed>()(
	"SessionTranscriptReadFailed",
	{
		workspaceId: Schema.optional(Schema.String),
		sessionId: Schema.String,
		sessionFilePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionPromptRejected extends Schema.TaggedError<SessionPromptRejected>()("SessionPromptRejected", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionPromptFailed extends Schema.TaggedError<SessionPromptFailed>()("SessionPromptFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	runId: Schema.optional(Schema.String),
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionCancelFailed extends Schema.TaggedError<SessionCancelFailed>()("SessionCancelFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	runId: Schema.optional(Schema.String),
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionQueueRestoreFailed extends Schema.TaggedError<SessionQueueRestoreFailed>()(
	"SessionQueueRestoreFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionTreeUnavailable extends Schema.TaggedError<SessionTreeUnavailable>()("SessionTreeUnavailable", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionTreeNavigationFailed extends Schema.TaggedError<SessionTreeNavigationFailed>()(
	"SessionTreeNavigationFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		targetEntryId: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionTreeLabelUpdateFailed extends Schema.TaggedError<SessionTreeLabelUpdateFailed>()(
	"SessionTreeLabelUpdateFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		entryId: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SessionCompactFailed extends Schema.TaggedError<SessionCompactFailed>()("SessionCompactFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionCompactionNotActive extends Schema.TaggedError<SessionCompactionNotActive>()(
	"SessionCompactionNotActive",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		message: Schema.String,
	},
) {}

export class SlashCommandCatalogUnavailable extends Schema.TaggedError<SlashCommandCatalogUnavailable>()(
	"SlashCommandCatalogUnavailable",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class ResumeSearchFailed extends Schema.TaggedError<ResumeSearchFailed>()("ResumeSearchFailed", {
	workspaceId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class ResumeOpenFailed extends Schema.TaggedError<ResumeOpenFailed>()("ResumeOpenFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class ResumeRenameFailed extends Schema.TaggedError<ResumeRenameFailed>()("ResumeRenameFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class ResumeArchiveFailed extends Schema.TaggedError<ResumeArchiveFailed>()("ResumeArchiveFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionRunNotActive extends Schema.TaggedError<SessionRunNotActive>()("SessionRunNotActive", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class SessionModelNotFound extends Schema.TaggedError<SessionModelNotFound>()("SessionModelNotFound", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	provider: Schema.String,
	modelId: Schema.String,
	message: Schema.String,
}) {}

export class SessionModelAuthUnavailable extends Schema.TaggedError<SessionModelAuthUnavailable>()(
	"SessionModelAuthUnavailable",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		provider: Schema.String,
		modelId: Schema.String,
		message: Schema.String,
	},
) {}

export class SessionModelSetFailed extends Schema.TaggedError<SessionModelSetFailed>()("SessionModelSetFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	provider: Schema.String,
	modelId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionThinkingSetFailed extends Schema.TaggedError<SessionThinkingSetFailed>()(
	"SessionThinkingSetFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		thinkingLevel: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SettingsSummaryReadFailed extends Schema.TaggedError<SettingsSummaryReadFailed>()(
	"SettingsSummaryReadFailed",
	{
		workspaceId: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SettingsEditorReadFailed extends Schema.TaggedError<SettingsEditorReadFailed>()(
	"SettingsEditorReadFailed",
	{
		workspaceId: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class SettingsUpdateInvalid extends Schema.TaggedError<SettingsUpdateInvalid>()("SettingsUpdateInvalid", {
	workspaceId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SettingsUpdateFailed extends Schema.TaggedError<SettingsUpdateFailed>()("SettingsUpdateFailed", {
	workspaceId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SettingsFileUnavailable extends Schema.TaggedError<SettingsFileUnavailable>()("SettingsFileUnavailable", {
	workspaceId: Schema.String,
	scope: Schema.Literal("global", "project"),
	path: Schema.String,
	message: Schema.String,
}) {}

export class SettingsFileOpenFailed extends Schema.TaggedError<SettingsFileOpenFailed>()("SettingsFileOpenFailed", {
	workspaceId: Schema.String,
	scope: Schema.Literal("global", "project"),
	path: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class TrustStatusReadFailed extends Schema.TaggedError<TrustStatusReadFailed>()("TrustStatusReadFailed", {
	workspaceId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class TrustDecisionInvalid extends Schema.TaggedError<TrustDecisionInvalid>()("TrustDecisionInvalid", {
	workspaceId: Schema.String,
	optionId: Schema.String,
	message: Schema.String,
}) {}

export class TrustDecisionSaveFailed extends Schema.TaggedError<TrustDecisionSaveFailed>()("TrustDecisionSaveFailed", {
	workspaceId: Schema.String,
	optionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class ResourceInventoryReadFailed extends Schema.TaggedError<ResourceInventoryReadFailed>()(
	"ResourceInventoryReadFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class ResourceReloadFailed extends Schema.TaggedError<ResourceReloadFailed>()("ResourceReloadFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.optional(Schema.String),
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class ResourceSourceUnavailable extends Schema.TaggedError<ResourceSourceUnavailable>()(
	"ResourceSourceUnavailable",
	{
		workspaceId: Schema.String,
		resourceId: Schema.String,
		message: Schema.String,
	},
) {}

export class ResourceSourceOpenFailed extends Schema.TaggedError<ResourceSourceOpenFailed>()(
	"ResourceSourceOpenFailed",
	{
		workspaceId: Schema.String,
		resourceId: Schema.String,
		path: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class ExtensionUiRequestNotFound extends Schema.TaggedError<ExtensionUiRequestNotFound>()(
	"ExtensionUiRequestNotFound",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		extensionUiRequestId: Schema.String,
		message: Schema.String,
	},
) {}

export class ExtensionUiSessionMismatch extends Schema.TaggedError<ExtensionUiSessionMismatch>()(
	"ExtensionUiSessionMismatch",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		extensionUiRequestId: Schema.String,
		message: Schema.String,
	},
) {}

export class ExtensionUiResponseInvalid extends Schema.TaggedError<ExtensionUiResponseInvalid>()(
	"ExtensionUiResponseInvalid",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		extensionUiRequestId: Schema.String,
		message: Schema.String,
	},
) {}

export class ExtensionUiRequestCancelled extends Schema.TaggedError<ExtensionUiRequestCancelled>()(
	"ExtensionUiRequestCancelled",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		extensionUiRequestId: Schema.String,
		message: Schema.String,
	},
) {}

export class ImageAttachmentBlocked extends Schema.TaggedError<ImageAttachmentBlocked>()("ImageAttachmentBlocked", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class ImageAttachmentUnsupportedMime extends Schema.TaggedError<ImageAttachmentUnsupportedMime>()(
	"ImageAttachmentUnsupportedMime",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		filePath: Schema.optional(Schema.String),
		mimeType: Schema.optional(Schema.String),
		message: Schema.String,
	},
) {}

export class ImageAttachmentReadFailed extends Schema.TaggedError<ImageAttachmentReadFailed>()(
	"ImageAttachmentReadFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		filePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class ImageAttachmentResizeFailed extends Schema.TaggedError<ImageAttachmentResizeFailed>()(
	"ImageAttachmentResizeFailed",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		filePath: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.optional(Schema.String),
	},
) {}

export class ImageAttachmentTooLarge extends Schema.TaggedError<ImageAttachmentTooLarge>()("ImageAttachmentTooLarge", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	filePath: Schema.optional(Schema.String),
	sizeBytes: Schema.Number,
	maxBytes: Schema.Number,
	message: Schema.String,
}) {}

export class ImageAttachmentLimitExceeded extends Schema.TaggedError<ImageAttachmentLimitExceeded>()(
	"ImageAttachmentLimitExceeded",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		maxAttachments: Schema.Number,
		message: Schema.String,
	},
) {}

export class ImageAttachmentNotFound extends Schema.TaggedError<ImageAttachmentNotFound>()("ImageAttachmentNotFound", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	attachmentId: Schema.String,
	message: Schema.String,
}) {}

export class SessionExportUnavailable extends Schema.TaggedError<SessionExportUnavailable>()(
	"SessionExportUnavailable",
	{
		workspaceId: Schema.String,
		sessionId: Schema.String,
		message: Schema.String,
	},
) {}

export class SessionExportFailed extends Schema.TaggedError<SessionExportFailed>()("SessionExportFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	format: Schema.optional(Schema.String),
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionShareUnavailable extends Schema.TaggedError<SessionShareUnavailable>()("SessionShareUnavailable", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
}) {}

export class SessionShareAuthFailed extends Schema.TaggedError<SessionShareAuthFailed>()("SessionShareAuthFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class SessionShareFailed extends Schema.TaggedError<SessionShareFailed>()("SessionShareFailed", {
	workspaceId: Schema.String,
	sessionId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export class ArtifactNotFound extends Schema.TaggedError<ArtifactNotFound>()("ArtifactNotFound", {
	artifactId: Schema.String,
	message: Schema.String,
}) {}

export class ArtifactOpenFailed extends Schema.TaggedError<ArtifactOpenFailed>()("ArtifactOpenFailed", {
	artifactId: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.String),
}) {}

export const GuiError = Schema.Union(
	InvalidRendererCommand,
	UnauthorizedIpcSender,
	CommandNotImplemented,
	InternalIpcError,
	InvalidWorkspacePath,
	WorkspaceNotFound,
	WorkspacePathMissing,
	CatalogReadFailed,
	CatalogParseFailed,
	CatalogWriteFailed,
	SessionNotFound,
	SessionFileMissing,
	SessionSyncFailed,
	SessionCreateFailed,
	SessionRenameFailed,
	SessionRuntimeNotFound,
	SessionRuntimeCreateFailed,
	SessionRuntimeOpenFailed,
	SessionRuntimeCloseFailed,
	SessionRuntimeBindFailed,
	SessionAlreadyOpen,
	SessionOpenLimitReached,
	SessionRuntimeNotOpen,
	SessionTranscriptReadFailed,
	SessionPromptRejected,
	SessionPromptFailed,
	SessionCancelFailed,
	SessionQueueRestoreFailed,
	SessionTreeUnavailable,
	SessionTreeNavigationFailed,
	SessionTreeLabelUpdateFailed,
	SessionCompactFailed,
	SessionCompactionNotActive,
	SlashCommandCatalogUnavailable,
	ResumeSearchFailed,
	ResumeOpenFailed,
	ResumeRenameFailed,
	ResumeArchiveFailed,
	SessionRunNotActive,
	SessionModelNotFound,
	SessionModelAuthUnavailable,
	SessionModelSetFailed,
	SessionThinkingSetFailed,
	SettingsSummaryReadFailed,
	SettingsEditorReadFailed,
	SettingsUpdateInvalid,
	SettingsUpdateFailed,
	SettingsFileUnavailable,
	SettingsFileOpenFailed,
	TrustStatusReadFailed,
	TrustDecisionInvalid,
	TrustDecisionSaveFailed,
	ResourceInventoryReadFailed,
	ResourceReloadFailed,
	ResourceSourceUnavailable,
	ResourceSourceOpenFailed,
	ExtensionUiRequestNotFound,
	ExtensionUiSessionMismatch,
	ExtensionUiResponseInvalid,
	ExtensionUiRequestCancelled,
	ImageAttachmentBlocked,
	ImageAttachmentUnsupportedMime,
	ImageAttachmentReadFailed,
	ImageAttachmentResizeFailed,
	ImageAttachmentTooLarge,
	ImageAttachmentLimitExceeded,
	ImageAttachmentNotFound,
	SessionExportUnavailable,
	SessionExportFailed,
	SessionShareUnavailable,
	SessionShareAuthFailed,
	SessionShareFailed,
	ArtifactNotFound,
	ArtifactOpenFailed,
);
export type GuiError = Schema.Schema.Type<typeof GuiError>;

export const decodeGuiError = (value: unknown): Promise<GuiError> =>
	Effect.runPromise(Schema.decodeUnknown(GuiError)(value));
