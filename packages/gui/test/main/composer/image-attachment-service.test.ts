import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	ImageAttachmentBlocked,
	ImageAttachmentLimitExceeded,
	ImageAttachmentNotFound,
	ImageAttachmentService,
	ImageAttachmentTooLarge,
	ImageAttachmentUnsupportedMime,
	MAX_ATTACHMENTS_PER_SESSION,
	MAX_IMAGE_SOURCE_BYTES,
} from "../../../src/main/composer/image-attachment-service.ts";
import { sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");
const pngBytes = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ImageAttachmentService", () => {
	test("adds selected images as session-scoped snapshots and consumes them as ImageContent", async () => {
		const filePath = await writeTempImage("screen.png", pngBytes);
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			pickImageFiles: async () => [filePath],
		});

		const picked = await service.pickImages(workspaceId, sessionId);
		const consumed = service.consume(workspaceId, sessionId, [picked.attachments[0].id]);

		expect(picked.attachments).toEqual([
			expect.objectContaining({
				source: "file",
				fileName: "screen.png",
				mimeType: "image/png",
				previewDataUrl: `data:image/png;base64,${pngBytes.toString("base64")}`,
			}),
		]);
		expect(consumed).toEqual([{ type: "image", data: pngBytes.toString("base64"), mimeType: "image/png" }]);
		expect(service.list(workspaceId, sessionId).attachments).toEqual([]);
	});

	test("blocks image reads when Pi image settings block attachments", async () => {
		const filePath = await writeTempImage("screen.png", pngBytes);
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: true }),
			pickImageFiles: async () => [filePath],
		});

		await expect(service.pickImages(workspaceId, sessionId)).rejects.toBeInstanceOf(ImageAttachmentBlocked);
	});

	test("rejects unsupported image MIME types", async () => {
		const filePath = await writeTempImage("notes.txt", Buffer.from("not an image"));
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			pickImageFiles: async () => [filePath],
		});

		await expect(service.pickImages(workspaceId, sessionId)).rejects.toBeInstanceOf(ImageAttachmentUnsupportedMime);
	});

	test("rejects oversized files before reading image contents", async () => {
		const filePath = await writeTempImage("large.png", pngBytes);
		await truncate(filePath, MAX_IMAGE_SOURCE_BYTES + 1);
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			pickImageFiles: async () => [filePath],
		});

		await expect(service.pickImages(workspaceId, sessionId)).rejects.toBeInstanceOf(ImageAttachmentTooLarge);
	});

	test("rejects sessions with too many pending attachments", async () => {
		const filePaths = await Promise.all(
			Array.from({ length: MAX_ATTACHMENTS_PER_SESSION + 1 }, (_, index) =>
				writeTempImage(`screen-${index}.png`, pngBytes),
			),
		);
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			pickImageFiles: async () => filePaths,
		});

		await expect(service.pickImages(workspaceId, sessionId)).rejects.toBeInstanceOf(ImageAttachmentLimitExceeded);
	});

	test("pastes clipboard images and reports empty clipboard as a typed read failure", async () => {
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			readClipboardImage: async () => ({ data: pngBytes, mimeType: "image/png", fileName: "clipboard.png" }),
		});

		const pasted = await service.pasteImageFromClipboard(workspaceId, sessionId);
		expect(pasted.attachments[0]).toMatchObject({ source: "clipboard", fileName: "clipboard.png" });

		const emptyService = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			readClipboardImage: async () => undefined,
		});
		await expect(emptyService.pasteImageFromClipboard(workspaceId, sessionId)).rejects.toThrow(
			"Clipboard does not contain an image",
		);
	});

	test("rechecks blocked image settings when consuming attachments for send", async () => {
		let blockImages = false;
		const filePath = await writeTempImage("screen.png", pngBytes);
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages }),
			pickImageFiles: async () => [filePath],
		});
		const picked = await service.pickImages(workspaceId, sessionId);

		blockImages = true;

		await expect(service.consumeForSend(workspaceId, sessionId, [picked.attachments[0].id])).rejects.toBeInstanceOf(
			ImageAttachmentBlocked,
		);
	});

	test("removes and clears attachments without exposing image data to the renderer", async () => {
		const filePath = await writeTempImage("screen.png", pngBytes);
		const service = new ImageAttachmentService({
			getImageSettings: async () => ({ autoResize: false, blockImages: false }),
			pickImageFiles: async () => [filePath],
		});
		const picked = await service.pickImages(workspaceId, sessionId);

		expect(service.remove(workspaceId, sessionId, picked.attachments[0].id).attachments).toEqual([]);
		expect(() => service.consume(workspaceId, sessionId, [picked.attachments[0].id])).toThrow(
			ImageAttachmentNotFound,
		);

		const second = await service.pickImages(workspaceId, sessionId);
		expect(second.attachments).toHaveLength(1);
		expect(service.clear(workspaceId, sessionId).attachments).toEqual([]);
	});
});

async function writeTempImage(name: string, bytes: Buffer): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-gui-image-"));
	tempDirs.push(dir);
	const filePath = join(dir, name);
	await writeFile(filePath, bytes);
	return filePath;
}
