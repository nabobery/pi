import { Effect, Schema } from "effect";
import { GuiError } from "./errors.ts";
import { RequestId } from "./ids.ts";

export const GuiCommandSuccess = Schema.Struct({
	ok: Schema.Literal(true),
	requestId: RequestId,
	data: Schema.Unknown,
});
export type GuiCommandSuccess = Schema.Schema.Type<typeof GuiCommandSuccess>;

export const GuiCommandFailure = Schema.Struct({
	ok: Schema.Literal(false),
	requestId: RequestId,
	error: GuiError,
});
export type GuiCommandFailure = Schema.Schema.Type<typeof GuiCommandFailure>;

export const GuiCommandResult = Schema.Union(GuiCommandSuccess, GuiCommandFailure);
export type GuiCommandResult = Schema.Schema.Type<typeof GuiCommandResult>;

export const decodeGuiCommandResult = (value: unknown): Promise<GuiCommandResult> =>
	Effect.runPromise(Schema.decodeUnknown(GuiCommandResult)(value));
