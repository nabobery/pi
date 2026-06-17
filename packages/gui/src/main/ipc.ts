import { type App, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { AppOriginPolicy } from "./app-origin-policy.ts";
import { createAppInfo } from "./app-info.ts";
import { isAllowedAppUrl } from "./app-origin-policy.ts";
import { APP_GET_INFO_CHANNEL } from "../shared/contracts.ts";

interface AppInfoInvokeEvent {
	senderFrame: { url: string } | null;
}

export function createAppInfoHandler(
	app: Pick<App, "getName" | "getVersion">,
	mode: string | undefined,
	policy: AppOriginPolicy,
) {
	return (event: AppInfoInvokeEvent) => {
		if (!event.senderFrame) {
			throw new Error("Blocked IPC from missing sender frame");
		}
		if (!isAllowedAppUrl(policy, event.senderFrame.url)) {
			throw new Error(`Blocked IPC from untrusted renderer URL: ${event.senderFrame.url}`);
		}
		return createAppInfo(app, mode);
	};
}

export function registerAppInfoHandler(app: App, mode: string | undefined, policy: AppOriginPolicy): void {
	const handler = createAppInfoHandler(app, mode, policy);
	ipcMain.handle(APP_GET_INFO_CHANNEL, (event: IpcMainInvokeEvent) => handler(event));
}
