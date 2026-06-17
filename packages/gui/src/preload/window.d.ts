import type { PiGuiApi } from "./pi-gui-api.ts";

declare global {
	interface Window {
		piGui: PiGuiApi;
	}
}

export {};
