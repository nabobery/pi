import type { AppInfo } from "../shared/contracts.ts";

export interface AppMetadataProvider {
	getName(): string;
	getVersion(): string;
}

export function createAppInfo(app: AppMetadataProvider, mode: string | undefined): AppInfo {
	return {
		name: app.getName(),
		version: app.getVersion(),
		mode: mode ?? "production",
	};
}
