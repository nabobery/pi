import { APP_GET_INFO_CHANNEL, type AppInfo } from "../shared/contracts.ts";

export interface PiGuiApi {
	getAppInfo(): Promise<AppInfo>;
}

export type AppInfoInvoker = (channel: typeof APP_GET_INFO_CHANNEL) => Promise<AppInfo>;

export function createPiGuiApi(invoke: AppInfoInvoker): PiGuiApi {
	return {
		getAppInfo: () => invoke(APP_GET_INFO_CHANNEL),
	};
}
