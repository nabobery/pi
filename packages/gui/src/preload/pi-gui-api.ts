import {
	type GuiCommand,
	type GuiCommandResult,
	type GuiEvent,
	InternalIpcError,
	decodeGuiCommandResult,
	decodeGuiEvent,
} from "../contracts/index.ts";
import { PI_GUI_EVENT_CHANNEL, PI_GUI_INVOKE_CHANNEL } from "../shared/contracts.ts";

export interface PiGuiApi {
	invoke(command: GuiCommand): Promise<GuiCommandResult>;
	subscribe(listener: (event: GuiEvent) => void): () => void;
}

export interface PiGuiApiTransport {
	invoke(channel: typeof PI_GUI_INVOKE_CHANNEL, command: GuiCommand): Promise<unknown>;
	on(channel: typeof PI_GUI_EVENT_CHANNEL, listener: (event: unknown) => void): () => void;
}

export function createPiGuiApi(transport: PiGuiApiTransport): PiGuiApi {
	return {
		invoke: async (command) => {
			const result = await transport.invoke(PI_GUI_INVOKE_CHANNEL, command);
			try {
				return await decodeGuiCommandResult(result);
			} catch (error) {
				return {
					ok: false,
					requestId: command.requestId,
					error: new InternalIpcError({
						message: "Invalid IPC response",
						cause: getErrorMessage(error),
					}),
				};
			}
		},
		subscribe: (listener) =>
			transport.on(PI_GUI_EVENT_CHANNEL, (value) => {
				void decodeGuiEvent(value).then(listener, () => undefined);
			}),
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
