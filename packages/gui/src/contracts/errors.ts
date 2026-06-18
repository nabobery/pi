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
);
export type GuiError = Schema.Schema.Type<typeof GuiError>;

export const decodeGuiError = (value: unknown): Promise<GuiError> =>
	Effect.runPromise(Schema.decodeUnknown(GuiError)(value));
