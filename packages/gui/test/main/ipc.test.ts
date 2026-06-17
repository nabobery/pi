import { describe, expect, test } from "vitest";
import { createAppInfo } from "../../src/main/app-info.ts";
import { createAppOriginPolicy, getPackagedRendererEntryUrl } from "../../src/main/app-origin-policy.ts";
import { createAppInfoHandler } from "../../src/main/ipc.ts";

const app = {
	getName: () => "Pi GUI",
	getVersion: () => "1.2.3",
};

const policy = createAppOriginPolicy({
	packagedRendererUrl: getPackagedRendererEntryUrl("/Applications/Pi.app/Contents/Resources/app.asar/dist/main"),
});

describe("createAppInfoHandler", () => {
	test("returns app info for trusted renderer senders", () => {
		const handler = createAppInfoHandler(app, "test", policy);

		expect(handler({ senderFrame: { url: policy.packagedRendererUrl.href } })).toEqual(createAppInfo(app, "test"));
	});

	test("rejects untrusted renderer senders", () => {
		const handler = createAppInfoHandler(app, "test", policy);

		expect(() => handler({ senderFrame: { url: "file:///tmp/attacker.html" } })).toThrow(
			"Blocked IPC from untrusted renderer URL: file:///tmp/attacker.html",
		);
	});

	test("rejects missing sender frames", () => {
		const handler = createAppInfoHandler(app, "test", policy);

		expect(() => handler({ senderFrame: null })).toThrow("Blocked IPC from missing sender frame");
	});
});
