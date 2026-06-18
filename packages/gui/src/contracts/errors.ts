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

export const GuiError = Schema.Union(
	InvalidRendererCommand,
	UnauthorizedIpcSender,
	CommandNotImplemented,
	InternalIpcError,
);
export type GuiError = Schema.Schema.Type<typeof GuiError>;

export const decodeGuiError = (value: unknown): Promise<GuiError> =>
	Effect.runPromise(Schema.decodeUnknown(GuiError)(value));
