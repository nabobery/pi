import {
	AppBootstrap,
	type GuiCommand,
	type GuiCommandResult,
	decodeBootstrapSnapshot,
	requestIdFromString,
} from "../../contracts/index.ts";
import type { AppInfo } from "../../shared/contracts.ts";

export type LoadState =
	| { status: "loading" }
	| { status: "ready"; appInfo: AppInfo }
	| { status: "failed"; message: string };

export interface BootstrapApi {
	invoke(command: GuiCommand): Promise<GuiCommandResult>;
}

export async function loadBootstrapState(api: BootstrapApi): Promise<LoadState> {
	try {
		const result = await api.invoke(new AppBootstrap({ requestId: requestIdFromString("renderer-bootstrap") }));
		if (!result.ok) return { status: "failed", message: result.error.message };

		const bootstrap = await decodeBootstrap(result.data);
		return { status: "ready", appInfo: bootstrap.appInfo };
	} catch (error) {
		return { status: "failed", message: getErrorMessage(error) };
	}
}

async function decodeBootstrap(data: unknown) {
	try {
		return await decodeBootstrapSnapshot(data);
	} catch {
		throw new Error("Invalid bootstrap response");
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "Unknown startup failure";
}
