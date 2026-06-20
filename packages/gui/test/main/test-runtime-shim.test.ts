import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	BUILTIN_SLASH_COMMANDS,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	detectSupportedImageMimeTypeFromFile,
	filterAndSortSessions,
	formatDimensionNote,
	getAgentDir,
	getDefaultSessionDir,
	getProjectTrustOptions,
	getShareViewerUrl,
	getSupportedThinkingLevels,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	resizeImage,
	SessionManager,
	SettingsManager,
} from "../../src/main/test-runtime-shim.ts";

describe("test-runtime-shim", () => {
	test("exposes deterministic defaults for E2E fake-runtime builds", async () => {
		const previousHome = process.env.HOME;
		process.env.HOME = "/tmp/pi-gui-home";
		try {
			expect(getAgentDir()).toBe("/tmp/pi-gui-home/.pi");
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		}

		expect(getShareViewerUrl("abc123")).toBe("https://pi.dev/session/#abc123");
		expect(getDefaultSessionDir("/tmp/workspace")).toBe("/tmp/workspace/.pi/sessions");
		expect(filterAndSortSessions([{ id: "session-1" }])).toEqual([{ id: "session-1" }]);
		expect(BUILTIN_SLASH_COMMANDS.map((command) => command.name)).toEqual([
			"settings",
			"model",
			"compact",
			"resume",
			"new",
		]);
		expect(getProjectTrustOptions()).toEqual([]);
		expect(hasTrustRequiringProjectResources()).toBe(false);
		expect(getSupportedThinkingLevels()).toEqual(["off"]);
		await expect(SessionManager.list()).resolves.toEqual([]);
		expect(() => SessionManager.open()).toThrow("Pi SDK SessionManager is unavailable");
		expect(new ProjectTrustStore().getEntry()).toBeUndefined();
	});

	test("exposes deterministic settings defaults", () => {
		const settings = SettingsManager.create();

		expect(settings.drainErrors()).toEqual([]);
		expect(settings.getDefaultProvider()).toBeUndefined();
		expect(settings.getDefaultModel()).toBeUndefined();
		expect(settings.getDefaultThinkingLevel()).toBeUndefined();
		expect(settings.getEnableSkillCommands()).toBe(true);
		expect(settings.getSteeringMode()).toBe("all");
		expect(settings.getFollowUpMode()).toBe("all");
		expect(settings.getDefaultProjectTrust()).toBe("ask");
	});

	test("sniffs supported image MIME types and provides no-op resize helpers", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "pi-gui-shim-"));
		try {
			const pngPath = join(tempDir, "image.png");
			const jpegPath = join(tempDir, "image.jpg");
			const gifPath = join(tempDir, "image.gif");
			const webpPath = join(tempDir, "image.webp");
			const textPath = join(tempDir, "image.txt");
			const invalidPngPath = join(tempDir, "invalid.png");
			const animatedPngPath = join(tempDir, "animated.png");
			const jpegLsPath = join(tempDir, "image-ls.jpg");
			await writeFile(pngPath, minimalPngBytes());
			await writeFile(invalidPngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
			await writeFile(animatedPngPath, animatedPngBytes());
			await writeFile(jpegPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
			await writeFile(jpegLsPath, Buffer.from([0xff, 0xd8, 0xff, 0xf7]));
			await writeFile(gifPath, "GIF89a", "utf8");
			await writeFile(webpPath, Buffer.from("RIFFxxxxWEBP", "ascii"));
			await writeFile(textPath, "not an image", "utf8");

			await expect(detectSupportedImageMimeTypeFromFile(pngPath)).resolves.toBe("image/png");
			await expect(detectSupportedImageMimeTypeFromFile(invalidPngPath)).resolves.toBeNull();
			await expect(detectSupportedImageMimeTypeFromFile(animatedPngPath)).resolves.toBeNull();
			await expect(detectSupportedImageMimeTypeFromFile(jpegPath)).resolves.toBe("image/jpeg");
			await expect(detectSupportedImageMimeTypeFromFile(jpegLsPath)).resolves.toBeNull();
			await expect(detectSupportedImageMimeTypeFromFile(gifPath)).resolves.toBe("image/gif");
			await expect(detectSupportedImageMimeTypeFromFile(webpPath)).resolves.toBe("image/webp");
			await expect(detectSupportedImageMimeTypeFromFile(textPath)).resolves.toBeNull();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		const resized = await resizeImage(Buffer.from("abc"), "image/png");
		expect(resized).toMatchObject({
			data: Buffer.from("abc").toString("base64"),
			mimeType: "image/png",
			wasResized: false,
		});
		expect(formatDimensionNote(resized)).toBeUndefined();
		expect(
			formatDimensionNote({
				...resized,
				height: 50,
				originalHeight: 100,
				originalWidth: 200,
				wasResized: true,
				width: 100,
			}),
		).toContain("Multiply coordinates by 2.00");
	});

	test("throws explicit errors for unavailable production runtime factories", () => {
		expect(() => createAgentSessionRuntime()).toThrow("Pi SDK runtime is unavailable");
		expect(() => createAgentSessionServices()).toThrow("Pi SDK services are unavailable");
		expect(() => createAgentSessionFromServices()).toThrow("Pi SDK session is unavailable");
	});
});

function minimalPngBytes(): Buffer {
	return Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
		0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	]);
}

function animatedPngBytes(): Buffer {
	return Buffer.from([...minimalPngBytes(), 0x00, 0x00, 0x00, 0x00, 0x61, 0x63, 0x54, 0x4c, 0x00, 0x00, 0x00, 0x00]);
}
