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

export const SessionStatus = Schema.Literal("idle", "opening", "ready", "replacing", "running", "failed", "closed");
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
			kind: Schema.Literal("user", "assistant", "tool", "system"),
			text: Schema.String,
		}),
	),
});
export type TimelineSnapshot = Schema.Schema.Type<typeof TimelineSnapshot>;
export const decodeTimelineSnapshot = (value: unknown): Promise<TimelineSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(TimelineSnapshot)(value));

export const ModelThinkingSnapshot = Schema.Struct({
	provider: Schema.optional(Schema.String),
	modelId: Schema.optional(Schema.String),
	thinkingLevel: Schema.optional(Schema.String),
});
export type ModelThinkingSnapshot = Schema.Schema.Type<typeof ModelThinkingSnapshot>;

export const SettingsSummarySnapshot = Schema.Struct({
	globalSettingsPath: Schema.optional(Schema.String),
	projectSettingsPath: Schema.optional(Schema.String),
});
export type SettingsSummarySnapshot = Schema.Schema.Type<typeof SettingsSummarySnapshot>;

export const ExtensionUiRequestSnapshot = Schema.Struct({
	id: ExtensionUiRequestId,
	sessionId: SessionId,
	kind: Schema.Literal("confirm", "input", "select", "notify", "editor"),
	title: Schema.String,
});
export type ExtensionUiRequestSnapshot = Schema.Schema.Type<typeof ExtensionUiRequestSnapshot>;

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
