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

export const TrustStatusSnapshot = Schema.Struct({
	workspaceId: WorkspaceId,
	cwd: Schema.String,
	trusted: Schema.Boolean,
	source: Schema.Literal("saved", "default", "session", "unknown"),
	savedPath: Schema.optional(Schema.String),
	requiresTrust: Schema.Boolean,
	options: Schema.Array(
		Schema.Struct({
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
