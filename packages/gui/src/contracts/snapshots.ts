import { Effect, Schema } from "effect";
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
});
export type WorkspaceSnapshot = Schema.Schema.Type<typeof WorkspaceSnapshot>;

export const SessionStatus = Schema.Literal("idle", "opening", "ready", "running", "failed", "closed");
export type SessionStatus = Schema.Schema.Type<typeof SessionStatus>;

export const SessionSnapshot = Schema.Struct({
	id: SessionId,
	workspaceId: WorkspaceId,
	title: Schema.String,
	status: SessionStatus,
});
export type SessionSnapshot = Schema.Schema.Type<typeof SessionSnapshot>;

export const TimelineSnapshot = Schema.Struct({
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
});
export type BootstrapSnapshot = Schema.Schema.Type<typeof BootstrapSnapshot>;
export const decodeBootstrapSnapshot = (value: unknown): Promise<BootstrapSnapshot> =>
	Effect.runPromise(Schema.decodeUnknown(BootstrapSnapshot)(value));

export const WorkspaceCatalogSnapshot = Schema.Struct({
	revision: CatalogRevision,
	workspaces: Schema.Array(WorkspaceSnapshot),
});
export type WorkspaceCatalogSnapshot = Schema.Schema.Type<typeof WorkspaceCatalogSnapshot>;

export const RunSnapshot = Schema.Struct({
	id: RunId,
	sessionId: SessionId,
	status: Schema.Literal("running", "completed", "failed", "cancelled"),
});
export type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
