import {
	AppBootstrap,
	type GuiError,
	type GuiCommand,
	type WorkspaceCatalogSnapshot,
	catalogRevisionFromString,
	decodeBootstrapSnapshot,
	decodeGuiCommandResult,
	requestIdFromString,
} from "../../contracts/index.ts";
import type { AppInfo } from "../../shared/contracts.ts";

export type LoadState =
	| { status: "loading" }
	| { status: "ready"; appInfo: AppInfo; workspaceCatalog: WorkspaceCatalogSnapshot; warnings: readonly GuiError[] }
	| { status: "failed"; message: string };

export interface BootstrapApi {
	invoke(command: GuiCommand): Promise<unknown>;
}

export async function loadBootstrapState(api: BootstrapApi): Promise<LoadState> {
	try {
		const result = await decodeGuiCommandResult(
			await api.invoke(new AppBootstrap({ requestId: requestIdFromString("renderer-bootstrap") })),
		);
		if (!result.ok) return { status: "failed", message: result.error.message };

		const bootstrap = await decodeBootstrap(result.data);
		return {
			status: "ready",
			appInfo: bootstrap.appInfo,
			workspaceCatalog: bootstrap.workspaceCatalog ?? emptyWorkspaceCatalog(),
			warnings: bootstrap.warnings ?? [],
		};
	} catch (error) {
		return { status: "failed", message: getErrorMessage(error) };
	}
}

function emptyWorkspaceCatalog(): WorkspaceCatalogSnapshot {
	return { revision: catalogRevisionFromString("0"), workspaces: [] };
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
