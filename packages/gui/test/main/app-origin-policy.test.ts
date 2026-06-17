import { describe, expect, test } from "vitest";
import {
	createAppOriginPolicy,
	getPackagedRendererEntryUrl,
	isAllowedAppUrl,
	resolveRendererTarget,
} from "../../src/main/app-origin-policy.ts";

const packagedRendererUrl = getPackagedRendererEntryUrl("/Applications/Pi.app/Contents/Resources/app.asar/dist/main");

describe("app origin policy", () => {
	test("allows only the packaged renderer entrypoint for file URLs", () => {
		const policy = createAppOriginPolicy({ packagedRendererUrl });

		expect(isAllowedAppUrl(policy, packagedRendererUrl.href)).toBe(true);
		expect(
			isAllowedAppUrl(policy, "file:///Applications/Pi.app/Contents/Resources/app.asar/dist/renderer/settings.html"),
		).toBe(false);
		expect(isAllowedAppUrl(policy, "file:///tmp/attacker.html")).toBe(false);
	});

	test("allows configured electron-vite development origins", () => {
		const policy = createAppOriginPolicy({
			devServerUrl: "http://localhost:5173/",
			packagedRendererUrl,
		});

		expect(isAllowedAppUrl(policy, "http://localhost:5173/")).toBe(true);
		expect(isAllowedAppUrl(policy, "http://localhost:5173/src/renderer/main.tsx")).toBe(true);
		expect(isAllowedAppUrl(policy, "http://127.0.0.1:5173/")).toBe(false);
		expect(isAllowedAppUrl(policy, "https://localhost:5173/")).toBe(false);
	});

	test("rejects external, unsafe, and malformed URLs", () => {
		const policy = createAppOriginPolicy({ packagedRendererUrl });

		expect(isAllowedAppUrl(policy, "https://example.com")).toBe(false);
		expect(isAllowedAppUrl(policy, "http://example.com")).toBe(false);
		expect(isAllowedAppUrl(policy, "javascript:alert(1)")).toBe(false);
		expect(isAllowedAppUrl(policy, "not a url")).toBe(false);
	});

	test("fails closed for invalid development renderer URLs", () => {
		expect(() =>
			resolveRendererTarget({
				devServerUrl: "https://example.com",
				mainProcessDir: "/Applications/Pi.app/Contents/Resources/app.asar/dist/main",
			}),
		).toThrow("Refusing to load untrusted renderer URL: https://example.com");

		expect(() =>
			resolveRendererTarget({
				devServerUrl: "not a url",
				mainProcessDir: "/Applications/Pi.app/Contents/Resources/app.asar/dist/main",
			}),
		).toThrow("Refusing to load untrusted renderer URL: not a url");
	});

	test("resolves packaged renderer when no development server is configured", () => {
		expect(
			resolveRendererTarget({
				devServerUrl: undefined,
				mainProcessDir: "/Applications/Pi.app/Contents/Resources/app.asar/dist/main",
			}),
		).toEqual({
			kind: "file",
			path: "/Applications/Pi.app/Contents/Resources/app.asar/dist/renderer/index.html",
		});
	});
});
