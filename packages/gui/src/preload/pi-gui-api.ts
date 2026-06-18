import { type GuiCommand, type GuiCommandResult, type GuiEvent } from "../contracts/index.ts";
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
			return result as GuiCommandResult;
		},
		subscribe: (listener) =>
			transport.on(PI_GUI_EVENT_CHANNEL, (value) => {
				listener(value as GuiEvent);
			}),
	};
}
