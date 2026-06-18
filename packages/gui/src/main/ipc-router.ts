import { type App, type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import {
	AppBootstrap,
	CommandNotImplemented,
	type GuiCommand,
	type GuiCommandResult,
	type GuiError,
	type GuiEvent,
	InvalidRendererCommand,
	ReceiptEmitted,
	UnauthorizedIpcSender,
	decodeGuiCommand,
	eventIdFromString,
	requestIdFromString,
} from "../contracts/index.ts";
import { PI_GUI_EVENT_CHANNEL, PI_GUI_INVOKE_CHANNEL } from "../shared/contracts.ts";
import type { AppOriginPolicy } from "./app-origin-policy.ts";
import { createAppInfo } from "./app-info.ts";
import { isAllowedAppUrl } from "./app-origin-policy.ts";

export interface GuiIpcInvokeEvent {
	senderFrame: { url: string } | null;
	sender: RendererEventSender;
}

export interface CreateGuiInvokeHandlerOptions {
	app: Pick<App, "getName" | "getVersion">;
	eventBus: RendererEventBus;
	mode: string | undefined;
	policy: AppOriginPolicy;
}

type RendererEventSender = Pick<WebContents, "id" | "isDestroyed" | "once" | "send">;

export class RendererEventBus {
	private sequence = 0;
	private senders = new Map<number, RendererEventSender>();

	registerSender(sender: RendererEventSender): void {
		if (sender.isDestroyed()) return;
		if (this.senders.has(sender.id)) return;

		this.senders.set(sender.id, sender);
		sender.once("destroyed", () => {
			this.senders.delete(sender.id);
		});
	}

	publishReceipt(requestId: string, receipt: string): void {
		this.publish(
			new ReceiptEmitted({
				eventId: eventIdFromString(`event-${this.sequence + 1}`),
				sequence: this.sequence + 1,
				receipt,
				requestId: requestIdFromString(requestId),
			}),
		);
	}

	private publish(event: GuiEvent): void {
		this.sequence += 1;
		for (const [senderId, sender] of this.senders) {
			if (sender.isDestroyed()) {
				this.senders.delete(senderId);
				continue;
			}
			sender.send(PI_GUI_EVENT_CHANNEL, event);
		}
	}
}

export function createGuiInvokeHandler(options: CreateGuiInvokeHandlerOptions) {
	return async (event: GuiIpcInvokeEvent, payload: unknown): Promise<GuiCommandResult> => {
		const requestId = getRequestId(payload);
		const senderError = validateSender(options.policy, event);
		if (senderError) return failureResult(requestId, senderError);
		options.eventBus.registerSender(event.sender);

		const command = await decodeCommand(payload);
		if (command instanceof InvalidRendererCommand) return failureResult(requestId, command);

		return handleGuiCommand(command, options);
	};
}

export function registerGuiIpcHandlers(app: App, mode: string | undefined, policy: AppOriginPolicy): RendererEventBus {
	const eventBus = new RendererEventBus();
	const handler = createGuiInvokeHandler({ app, eventBus, mode, policy });

	ipcMain.handle(PI_GUI_INVOKE_CHANNEL, (event: IpcMainInvokeEvent, payload: unknown) => handler(event, payload));

	return eventBus;
}

async function decodeCommand(payload: unknown): Promise<GuiCommand | InvalidRendererCommand> {
	try {
		return await decodeGuiCommand(payload);
	} catch (error) {
		return new InvalidRendererCommand({
			message: "Invalid renderer command",
			cause: getErrorMessage(error),
		});
	}
}

function handleGuiCommand(command: GuiCommand, options: CreateGuiInvokeHandlerOptions): GuiCommandResult {
	if (command instanceof AppBootstrap) {
		options.eventBus.publishReceipt(command.requestId, "app.bootstrap.accepted");
		const data = { appInfo: createAppInfo(options.app, options.mode) };
		options.eventBus.publishReceipt(command.requestId, "app.bootstrap.completed");
		return { ok: true, requestId: command.requestId, data };
	}

	return failureResult(
		command.requestId,
		new CommandNotImplemented({
			commandTag: command._tag,
			message: `${command._tag} is not implemented in Phase 2`,
		}),
	);
}

function validateSender(policy: AppOriginPolicy, event: GuiIpcInvokeEvent): UnauthorizedIpcSender | undefined {
	if (!event.senderFrame) {
		return new UnauthorizedIpcSender({ message: "Blocked IPC from missing sender frame" });
	}
	if (!isAllowedAppUrl(policy, event.senderFrame.url)) {
		return new UnauthorizedIpcSender({
			message: `Blocked IPC from untrusted renderer URL: ${event.senderFrame.url}`,
		});
	}
	return undefined;
}

function failureResult(requestId: string, error: GuiError): GuiCommandResult {
	return { ok: false, requestId: requestIdFromString(requestId), error };
}

function getRequestId(payload: unknown): string {
	if (typeof payload !== "object" || !payload || !("requestId" in payload)) return "unknown-request";
	const requestId = (payload as { requestId: unknown }).requestId;
	return typeof requestId === "string" && requestId.length > 0 ? requestId : "unknown-request";
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
