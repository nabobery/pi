import { Effect, Schema } from "effect";
import { GuiError } from "./errors.ts";
import { CatalogRevision, ExtensionUiRequestId, RunId, SessionId, WorkspaceId } from "./ids.ts";

export const AppInfoSnapshot = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	mode: Schema.String,
});
export type AppInfoSnapshot = Schema.Schema.Type<typeof AppInfoSnapshot>;

export const WorkspaceSnapshot = Schema.Struct({
	id: WorkspaceId,
	path: Schema.String,
	name: Schema.String,
	lastOpenedAt: Schema.String,
	sortOrder: Schema.Number,
	missing: Schema.Boolean,
	selected: Schema.optional(Schema.Boolean),
});
export type WorkspaceSnapshot = Schema.Schema.Type<typeof WorkspaceSnapshot>;

export const SessionStatus = Schema.Literal(
	"idle",
	"opening",
	"ready",
	"replacing",
	"navigating",
	"compacting",
	"running",
	"cancelling",
	"failed",
	"closed",
);
export type SessionStatus = Schema.Schema.Type<typeof SessionStatus>;

export const SessionSnapshot = Schema.Struct({
	id: SessionId,
	workspaceId: WorkspaceId,
	title: Schema.String,
	status: SessionStatus,
	updatedAt: Schema.String,
	preview: Schema.String,
	messageCount: Schema.Number,
	sessionFilePath: Schema.optional(Schema.String),
	archivedAt: Schema.optional(Schema.String),
});
export type SessionSnapshot = Schema.Schema.Type<typeof SessionSnapshot>;

export const TimelineSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	entries: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			kind: Schema.Literal("user", "assistant", "tool", "system", "error"),
			text: Schema.String,
			toolCallId: Schema.optional(Schema.String),
			toolName: Schema.optional(Schema.String),
			isLive: Schema.optional(Schema.Boolean),
			isError: Schema.optional(Schema.Boolean),
		}),
	),
});
export type TimelineSnapshot = Schema.Schema.Type<typeof TimelineSnapshot>;
export const decodeTimelineSnapshot = (value: unknown): Promise<TimelineSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(TimelineSnapshot)(value));

export const TreeFilterMode = Schema.Literal("default", "no-tools", "user-only", "labeled-only", "all");
export type TreeFilterMode = Schema.Schema.Type<typeof TreeFilterMode>;

export const TreeEntryKind = Schema.Literal(
	"user",
	"assistant",
	"tool",
	"system",
	"branchSummary",
	"compaction",
	"custom",
	"unknown",
);
export type TreeEntryKind = Schema.Schema.Type<typeof TreeEntryKind>;

export const SessionTreeEntrySnapshot = Schema.Struct({
	entryId: Schema.String,
	parentId: Schema.Union(Schema.String, Schema.Null),
	childIds: Schema.Array(Schema.String),
	depth: Schema.Number,
	kind: TreeEntryKind,
	textPreview: Schema.String,
	label: Schema.optional(Schema.String),
	labelTimestamp: Schema.optional(Schema.String),
	isActiveLeaf: Schema.Boolean,
	isActivePath: Schema.Boolean,
	hasChildren: Schema.Boolean,
	searchText: Schema.String,
});
export type SessionTreeEntrySnapshot = Schema.Schema.Type<typeof SessionTreeEntrySnapshot>;

export const SessionTreeSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	leafEntryId: Schema.Union(Schema.String, Schema.Null),
	entries: Schema.Array(SessionTreeEntrySnapshot),
	updatedAt: Schema.String,
});
export type SessionTreeSnapshot = Schema.Schema.Type<typeof SessionTreeSnapshot>;
export const decodeSessionTreeSnapshot = (value: unknown): Promise<SessionTreeSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(SessionTreeSnapshot)(value));

export const TreeNavigationSummaryMode = Schema.Literal("none", "default", "custom");
export type TreeNavigationSummaryMode = Schema.Schema.Type<typeof TreeNavigationSummaryMode>;

export const TreeNavigationSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	tree: SessionTreeSnapshot,
	timeline: TimelineSnapshot,
	editorText: Schema.optional(Schema.String),
	clearsComposer: Schema.Boolean,
	cancelled: Schema.Boolean,
	aborted: Schema.optional(Schema.Boolean),
	summaryEntryId: Schema.optional(Schema.String),
});
export type TreeNavigationSnapshot = Schema.Schema.Type<typeof TreeNavigationSnapshot>;
export const decodeTreeNavigationSnapshot = (value: unknown): Promise<TreeNavigationSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(TreeNavigationSnapshot)(value));

export const SessionCompactionSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	summary: Schema.optional(Schema.String),
	firstKeptEntryId: Schema.optional(Schema.String),
	tokensBefore: Schema.optional(Schema.Number),
	timeline: TimelineSnapshot,
	tree: SessionTreeSnapshot,
	cancelled: Schema.Boolean,
});
export type SessionCompactionSnapshot = Schema.Schema.Type<typeof SessionCompactionSnapshot>;
export const decodeSessionCompactionSnapshot = (value: unknown): Promise<SessionCompactionSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(SessionCompactionSnapshot)(value));

export const ThinkingLevel = Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh");
export type ThinkingLevel = Schema.Schema.Type<typeof ThinkingLevel>;

export const ModelOptionSnapshot = Schema.Struct({
	provider: Schema.String,
	modelId: Schema.String,
	name: Schema.String,
	authAvailable: Schema.Boolean,
	supportsThinking: Schema.Boolean,
	availableThinkingLevels: Schema.Array(ThinkingLevel),
});
export type ModelOptionSnapshot = Schema.Schema.Type<typeof ModelOptionSnapshot>;

export const ModelThinkingSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	provider: Schema.optional(Schema.String),
	modelId: Schema.optional(Schema.String),
	modelName: Schema.optional(Schema.String),
	thinkingLevel: ThinkingLevel,
	availableThinkingLevels: Schema.Array(ThinkingLevel),
	models: Schema.Array(ModelOptionSnapshot),
});
export type ModelThinkingSnapshot = Schema.Schema.Type<typeof ModelThinkingSnapshot>;
export const decodeModelThinkingSnapshot = (value: unknown): Promise<ModelThinkingSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(ModelThinkingSnapshot)(value));

export const SettingsSummarySnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	globalSettingsPath: Schema.String,
	projectSettingsPath: Schema.String,
	defaultProvider: Schema.optional(Schema.String),
	defaultModel: Schema.optional(Schema.String),
	defaultThinkingLevel: Schema.optional(ThinkingLevel),
	enableSkillCommands: Schema.Boolean,
	steeringMode: Schema.Literal("all", "one-at-a-time"),
	followUpMode: Schema.Literal("all", "one-at-a-time"),
	defaultProjectTrust: Schema.Literal("ask", "always", "never"),
	settingsDiagnostics: Schema.Array(
		Schema.Struct({
			message: Schema.String,
			path: Schema.optional(Schema.String),
		}),
	),
});
export type SettingsSummarySnapshot = Schema.Schema.Type<typeof SettingsSummarySnapshot>;
export const decodeSettingsSummarySnapshot = (value: unknown): Promise<SettingsSummarySnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(SettingsSummarySnapshot)(value));

export const SettingsSource = Schema.Literal("default", "global", "project");
export type SettingsSource = Schema.Schema.Type<typeof SettingsSource>;

export const SettingsValueSnapshot = Schema.Union(
	Schema.String,
	Schema.Boolean,
	Schema.Array(Schema.String),
	Schema.Null,
);
export type SettingsValueSnapshot = Schema.Schema.Type<typeof SettingsValueSnapshot>;

export const SettingsFieldSnapshot = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	source: SettingsSource,
	effectiveValue: SettingsValueSnapshot,
	globalValue: Schema.optional(SettingsValueSnapshot),
	projectValue: Schema.optional(SettingsValueSnapshot),
});
export type SettingsFieldSnapshot = Schema.Schema.Type<typeof SettingsFieldSnapshot>;

export const QueueMode = Schema.Literal("all", "one-at-a-time");
export type QueueMode = Schema.Schema.Type<typeof QueueMode>;

export const CommonSettingsPatch = Schema.Struct({
	defaultProvider: Schema.optional(Schema.NonEmptyTrimmedString),
	defaultModel: Schema.optional(Schema.NonEmptyTrimmedString),
	defaultThinkingLevel: Schema.optional(ThinkingLevel),
	enabledModels: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
	enableSkillCommands: Schema.optional(Schema.Boolean),
	steeringMode: Schema.optional(QueueMode),
	followUpMode: Schema.optional(QueueMode),
	defaultProjectTrust: Schema.optional(Schema.Literal("ask", "always", "never")),
	compactionEnabled: Schema.optional(Schema.Boolean),
	imageAutoResize: Schema.optional(Schema.Boolean),
	imageBlockImages: Schema.optional(Schema.Boolean),
});
export type CommonSettingsPatch = Schema.Schema.Type<typeof CommonSettingsPatch>;

export const SettingsEditorSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	globalSettingsPath: Schema.String,
	projectSettingsPath: Schema.String,
	fields: Schema.Array(SettingsFieldSnapshot),
	updatedAt: Schema.String,
	settingsDiagnostics: SettingsSummarySnapshot.fields.settingsDiagnostics,
});
export type SettingsEditorSnapshot = Schema.Schema.Type<typeof SettingsEditorSnapshot>;
export const decodeSettingsEditorSnapshot = (value: unknown): Promise<SettingsEditorSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(SettingsEditorSnapshot)(value));

export const QueueMessageKind = Schema.Literal("steering", "followUp");
export type QueueMessageKind = Schema.Schema.Type<typeof QueueMessageKind>;

export const QueueMessageSnapshot = Schema.Struct({
	index: Schema.Number,
	text: Schema.String,
	kind: QueueMessageKind,
});
export type QueueMessageSnapshot = Schema.Schema.Type<typeof QueueMessageSnapshot>;

export const QueueSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	steeringMessages: Schema.Array(QueueMessageSnapshot),
	followUpMessages: Schema.Array(QueueMessageSnapshot),
	steeringCount: Schema.Number,
	followUpCount: Schema.Number,
	steeringMode: QueueMode,
	followUpMode: QueueMode,
});
export type QueueSnapshot = Schema.Schema.Type<typeof QueueSnapshot>;
export const decodeQueueSnapshot = (value: unknown): Promise<QueueSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(QueueSnapshot)(value));

export const QueueRestoreSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	restoredMessages: Schema.Array(QueueMessageSnapshot),
	queue: QueueSnapshot,
});
export type QueueRestoreSnapshot = Schema.Schema.Type<typeof QueueRestoreSnapshot>;
export const decodeQueueRestoreSnapshot = (value: unknown): Promise<QueueRestoreSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(QueueRestoreSnapshot)(value));

export const SessionActivitySnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	hasUnread: Schema.Boolean,
	needsInput: Schema.Boolean,
	queueCount: Schema.Number,
	lastActivitySequence: Schema.Number,
});
export type SessionActivitySnapshot = Schema.Schema.Type<typeof SessionActivitySnapshot>;

export const SlashCommandSourceSnapshot = Schema.Literal("builtin", "extension", "prompt", "skill");
export type SlashCommandSourceSnapshot = Schema.Schema.Type<typeof SlashCommandSourceSnapshot>;

export const SlashCommandAvailability = Schema.Literal("guiAction", "insertOnly", "sendable", "deferred", "conflict");
export type SlashCommandAvailability = Schema.Schema.Type<typeof SlashCommandAvailability>;

export const SlashCommandSourceInfoSnapshot = Schema.Struct({
	path: Schema.String,
	source: Schema.String,
	scope: Schema.Literal("user", "project", "temporary"),
	origin: Schema.Literal("package", "top-level"),
	baseDir: Schema.optional(Schema.String),
});
export type SlashCommandSourceInfoSnapshot = Schema.Schema.Type<typeof SlashCommandSourceInfoSnapshot>;

export const SlashCommandSnapshot = Schema.Struct({
	name: Schema.String,
	description: Schema.optional(Schema.String),
	source: SlashCommandSourceSnapshot,
	sourceInfo: Schema.optional(SlashCommandSourceInfoSnapshot),
	availability: SlashCommandAvailability,
	disabledReason: Schema.optional(Schema.String),
});
export type SlashCommandSnapshot = Schema.Schema.Type<typeof SlashCommandSnapshot>;

export const SlashCommandCatalogSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	commands: Schema.Array(SlashCommandSnapshot),
	updatedAt: Schema.String,
});
export type SlashCommandCatalogSnapshot = Schema.Schema.Type<typeof SlashCommandCatalogSnapshot>;
export const decodeSlashCommandCatalogSnapshot = (value: unknown): Promise<SlashCommandCatalogSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(SlashCommandCatalogSnapshot)(value));

export const ResumeScope = Schema.Literal("currentWorkspace", "knownWorkspaces");
export type ResumeScope = Schema.Schema.Type<typeof ResumeScope>;

export const ResumeSortMode = Schema.Literal("threaded", "recent", "relevance");
export type ResumeSortMode = Schema.Schema.Type<typeof ResumeSortMode>;

export const ResumeNameFilter = Schema.Literal("all", "named");
export type ResumeNameFilter = Schema.Schema.Type<typeof ResumeNameFilter>;

export const ResumeSessionSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	workspaceName: Schema.String,
	sessionId: SessionId,
	title: Schema.String,
	preview: Schema.String,
	messageCount: Schema.Number,
	updatedAt: Schema.String,
	createdAt: Schema.String,
	cwd: Schema.String,
	sessionFilePath: Schema.String,
	parentSessionId: Schema.optional(SessionId),
	archivedAt: Schema.optional(Schema.String),
	isOpen: Schema.Boolean,
	isRunning: Schema.Boolean,
});
export type ResumeSessionSnapshot = Schema.Schema.Type<typeof ResumeSessionSnapshot>;

export const ResumeSearchSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	query: Schema.String,
	scope: ResumeScope,
	sortMode: ResumeSortMode,
	nameFilter: ResumeNameFilter,
	includeArchived: Schema.Boolean,
	results: Schema.Array(ResumeSessionSnapshot),
	totalCount: Schema.Number,
	filteredCount: Schema.Number,
	searchedAt: Schema.String,
});
export type ResumeSearchSnapshot = Schema.Schema.Type<typeof ResumeSearchSnapshot>;
export const decodeResumeSearchSnapshot = (value: unknown): Promise<ResumeSearchSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(ResumeSearchSnapshot)(value));

export const TrustStatusSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	cwd: Schema.String,
	trusted: Schema.Boolean,
	source: Schema.Literal("saved", "default", "session", "unknown"),
	savedPath: Schema.optional(Schema.String),
	requiresTrust: Schema.Boolean,
	options: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			label: Schema.String,
			trusted: Schema.Boolean,
			updates: Schema.Array(
				Schema.Struct({
					path: Schema.String,
					decision: Schema.Union(Schema.Boolean, Schema.Null),
				}),
			),
		}),
	),
});
export type TrustStatusSnapshot = Schema.Schema.Type<typeof TrustStatusSnapshot>;
export const decodeTrustStatusSnapshot = (value: unknown): Promise<TrustStatusSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(TrustStatusSnapshot)(value));

export const ResourceSourceInfoSnapshot = Schema.Struct({
	path: Schema.String,
	source: Schema.String,
	scope: Schema.Literal("user", "project", "temporary"),
	origin: Schema.Literal("package", "top-level"),
	baseDir: Schema.optional(Schema.String),
});
export type ResourceSourceInfoSnapshot = Schema.Schema.Type<typeof ResourceSourceInfoSnapshot>;

export const ResourceDiagnosticSnapshot = Schema.Struct({
	type: Schema.Literal("error", "warning", "collision"),
	message: Schema.String,
	path: Schema.optional(Schema.String),
});
export type ResourceDiagnosticSnapshot = Schema.Schema.Type<typeof ResourceDiagnosticSnapshot>;

export const SkillResourceSnapshot = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	description: Schema.String,
	filePath: Schema.String,
	baseDir: Schema.String,
	disableModelInvocation: Schema.Boolean,
	sourceInfo: ResourceSourceInfoSnapshot,
});
export type SkillResourceSnapshot = Schema.Schema.Type<typeof SkillResourceSnapshot>;

export const ExtensionResourceSnapshot = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	path: Schema.String,
	sourceInfo: ResourceSourceInfoSnapshot,
	commands: Schema.Number,
	tools: Schema.Number,
	flags: Schema.Number,
});
export type ExtensionResourceSnapshot = Schema.Schema.Type<typeof ExtensionResourceSnapshot>;

export const ExtensionLoadErrorSnapshot = Schema.Struct({
	id: Schema.String,
	path: Schema.String,
	error: Schema.String,
});
export type ExtensionLoadErrorSnapshot = Schema.Schema.Type<typeof ExtensionLoadErrorSnapshot>;

export const ResourceInventorySnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: Schema.optional(SessionId),
	skills: Schema.Array(SkillResourceSnapshot),
	extensions: Schema.Array(ExtensionResourceSnapshot),
	extensionErrors: Schema.Array(ExtensionLoadErrorSnapshot),
	diagnostics: Schema.Array(ResourceDiagnosticSnapshot),
	updatedAt: Schema.String,
});
export type ResourceInventorySnapshot = Schema.Schema.Type<typeof ResourceInventorySnapshot>;
export const decodeResourceInventorySnapshot = (value: unknown): Promise<ResourceInventorySnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(ResourceInventorySnapshot)(value));

export const ExtensionUiRequestSnapshot = Schema.Struct({
	id: ExtensionUiRequestId,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	kind: Schema.Literal("confirm", "input", "select", "editor", "getEditorText"),
	title: Schema.String,
	message: Schema.optional(Schema.String),
	placeholder: Schema.optional(Schema.String),
	options: Schema.optional(Schema.Array(Schema.String)),
	prefill: Schema.optional(Schema.String),
	timeoutMs: Schema.optional(Schema.Number),
});
export type ExtensionUiRequestSnapshot = Schema.Schema.Type<typeof ExtensionUiRequestSnapshot>;

export const ExtensionUiStateSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	kind: Schema.Literal("notify", "status", "title", "editorText"),
	message: Schema.optional(Schema.String),
	notifyType: Schema.optional(Schema.Literal("info", "warning", "error")),
	statusKey: Schema.optional(Schema.String),
	statusText: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	editorText: Schema.optional(Schema.String),
});
export type ExtensionUiStateSnapshot = Schema.Schema.Type<typeof ExtensionUiStateSnapshot>;

export const BootstrapSnapshot = Schema.Struct({
	appInfo: AppInfoSnapshot,
	workspaceCatalog: Schema.optional(Schema.suspend(() => WorkspaceCatalogSnapshot)),
	warnings: Schema.optional(Schema.Array(GuiError)),
});
export type BootstrapSnapshot = Schema.Schema.Type<typeof BootstrapSnapshot>;
export const decodeBootstrapSnapshot = (value: unknown): Promise<BootstrapSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(BootstrapSnapshot)(value));

export const WorkspaceCatalogSnapshot = Schema.Struct({
	revision: CatalogRevision,
	selectedWorkspaceId: Schema.optional(WorkspaceId),
	workspaces: Schema.Array(WorkspaceSnapshot),
});
export type WorkspaceCatalogSnapshot = Schema.Schema.Type<typeof WorkspaceCatalogSnapshot>;
export const decodeWorkspaceCatalogSnapshot = (value: unknown): Promise<WorkspaceCatalogSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(WorkspaceCatalogSnapshot)(value));

export const SessionCatalogSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	selectedSessionId: Schema.optional(SessionId),
	sessions: Schema.Array(SessionSnapshot),
});
export type SessionCatalogSnapshot = Schema.Schema.Type<typeof SessionCatalogSnapshot>;
export const decodeSessionCatalogSnapshot = (value: unknown): Promise<SessionCatalogSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(SessionCatalogSnapshot)(value));

export const RunSnapshot = Schema.Struct({
	id: RunId,
	sessionId: SessionId,
	status: Schema.Literal("running", "completed", "failed", "cancelled"),
});
export type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
