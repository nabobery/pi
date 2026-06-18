import type { App, BrowserWindow, Session } from "electron";
import { createAppOriginPolicy, getPackagedRendererEntryUrl, resolveRendererTarget } from "./app-origin-policy.ts";
import type { AppOriginPolicy, RendererTarget } from "./app-origin-policy.ts";
import type { CspSession } from "./content-security-policy.ts";

export interface StartPiGuiOptions {
	app: Pick<App, "exit" | "getName" | "getVersion" | "on" | "whenReady">;
	browserWindow: Pick<typeof BrowserWindow, "getAllWindows">;
	console: Pick<Console, "error">;
	createMainWindow(options: { appOriginPolicy: AppOriginPolicy; rendererTarget: RendererTarget }): unknown;
	devServerUrl: string | undefined;
	mainProcessDir: string;
	mode: string | undefined;
	registerGuiIpcHandlers(app: App, mode: string | undefined, policy: AppOriginPolicy): unknown;
	registerContentSecurityPolicy(session: StartupSession, isDevelopment: boolean): void;
	session: {
		defaultSession: StartupSession;
	};
}

type StartupSession = Pick<Session, "setPermissionRequestHandler"> & CspSession;

export async function startPiGui(options: StartPiGuiOptions): Promise<void> {
	await options.app
		.whenReady()
		.then(() => {
			const rendererTarget = resolveRendererTarget({
				devServerUrl: options.devServerUrl,
				mainProcessDir: options.mainProcessDir,
			});
			const appOriginPolicy = createAppOriginPolicy({
				devServerUrl: options.devServerUrl,
				packagedRendererUrl: getPackagedRendererEntryUrl(options.mainProcessDir),
			});
			const isDevelopment = rendererTarget.kind === "url";

			options.session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
				callback(false);
			});
			options.registerContentSecurityPolicy(options.session.defaultSession, isDevelopment);
			options.registerGuiIpcHandlers(options.app as App, options.mode, appOriginPolicy);
			options.createMainWindow({ appOriginPolicy, rendererTarget });

			options.app.on("activate", () => {
				if (options.browserWindow.getAllWindows().length === 0) {
					options.createMainWindow({ appOriginPolicy, rendererTarget });
				}
			});
		})
		.catch((error: unknown) => {
			options.console.error("Failed to start Pi GUI", error);
			options.app.exit(1);
		});
}
