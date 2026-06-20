import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
	detectSupportedImageMimeTypeFromFile,
	formatDimensionNote,
	resizeImage,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	ImageAttachmentBlocked,
	ImageAttachmentLimitExceeded,
	ImageAttachmentNotFound,
	ImageAttachmentReadFailed,
	ImageAttachmentResizeFailed,
	ImageAttachmentTooLarge,
	ImageAttachmentUnsupportedMime,
	type ImageAttachmentListSnapshot,
	type ImageAttachmentSnapshot,
	type SessionId,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { createRuntimeSessionKey } from "../session/session-key.ts";

export {
	ImageAttachmentBlocked,
	ImageAttachmentLimitExceeded,
	ImageAttachmentNotFound,
	ImageAttachmentReadFailed,
	ImageAttachmentResizeFailed,
	ImageAttachmentTooLarge,
	ImageAttachmentUnsupportedMime,
};

type SupportedImageMimeType = ImageAttachmentSnapshot["mimeType"];

export const MAX_ATTACHMENTS_PER_SESSION = 8;
export const MAX_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_SESSION_IMAGE_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 512 * 1024;
export const MAX_PREVIEW_DIMENSION = 512;

export interface ImageAttachmentSettings {
	autoResize: boolean;
	blockImages: boolean;
}

export interface ClipboardImagePayload {
	data: Buffer;
	mimeType: SupportedImageMimeType;
	fileName?: string;
}

interface StoredImageAttachment {
	data: string;
	mimeType: SupportedImageMimeType;
	snapshot: ImageAttachmentSnapshot;
	sourceSizeBytes: number;
}

export interface ImageAttachmentServiceOptions {
	getImageSettings: (workspaceId: WorkspaceId) => Promise<ImageAttachmentSettings>;
	pickImageFiles?: () => Promise<readonly string[] | undefined>;
	readClipboardImage?: () => Promise<ClipboardImagePayload | undefined>;
	now?: () => Date;
}

export class ImageAttachmentService {
	private readonly attachmentsBySession = new Map<string, StoredImageAttachment[]>();
	private readonly getImageSettings: ImageAttachmentServiceOptions["getImageSettings"];
	private readonly now: () => Date;
	private readonly pickImageFiles: ImageAttachmentServiceOptions["pickImageFiles"];
	private readonly readClipboardImage: ImageAttachmentServiceOptions["readClipboardImage"];

	constructor(options: ImageAttachmentServiceOptions) {
		this.getImageSettings = options.getImageSettings;
		this.pickImageFiles = options.pickImageFiles;
		this.readClipboardImage = options.readClipboardImage;
		this.now = options.now ?? (() => new Date());
	}

	list(workspaceId: WorkspaceId, sessionId: SessionId): ImageAttachmentListSnapshot {
		return this.snapshot(workspaceId, sessionId);
	}

	async pickImages(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ImageAttachmentListSnapshot> {
		await this.assertImagesAllowed(workspaceId, sessionId);
		const filePaths = await this.pickImageFiles?.();
		if (!filePaths || filePaths.length === 0) return this.snapshot(workspaceId, sessionId);
		this.assertCanAppendCount(workspaceId, sessionId, filePaths.length);
		const sourceSizes = await Promise.all(
			filePaths.map((filePath) => this.statSourceBytes(workspaceId, sessionId, filePath)),
		);
		let pendingBytes = 0;
		for (const [index, filePath] of filePaths.entries()) {
			const sourceSizeBytes = sourceSizes[index] ?? 0;
			assertSourceSizeWithinLimit(workspaceId, sessionId, sourceSizeBytes, filePath);
			pendingBytes += sourceSizeBytes;
			this.assertSessionBytesWithinLimit(workspaceId, sessionId, pendingBytes);
		}
		const attachments = await Promise.all(
			filePaths.map((filePath, index) =>
				this.createFromFile(workspaceId, sessionId, filePath, sourceSizes[index] ?? 0),
			),
		);
		this.append(workspaceId, sessionId, attachments);
		return this.snapshot(workspaceId, sessionId);
	}

	async pasteImageFromClipboard(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ImageAttachmentListSnapshot> {
		await this.assertImagesAllowed(workspaceId, sessionId);
		const image = await this.readClipboardImage?.();
		if (!image) {
			throw new ImageAttachmentReadFailed({
				workspaceId,
				sessionId,
				message: "Clipboard does not contain an image",
			});
		}
		this.assertCanAppendCount(workspaceId, sessionId, 1);
		assertSourceSizeWithinLimit(workspaceId, sessionId, image.data.byteLength, undefined);
		this.assertSessionBytesWithinLimit(workspaceId, sessionId, image.data.byteLength);
		const attachment = await this.createStoredAttachment({
			workspaceId,
			sessionId,
			source: "clipboard",
			fileName: image.fileName,
			mimeType: image.mimeType,
			buffer: image.data,
			sourceSizeBytes: image.data.byteLength,
		});
		this.append(workspaceId, sessionId, [attachment]);
		return this.snapshot(workspaceId, sessionId);
	}

	remove(workspaceId: WorkspaceId, sessionId: SessionId, attachmentId: string): ImageAttachmentListSnapshot {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const existing = this.attachmentsBySession.get(key) ?? [];
		const next = existing.filter((attachment) => attachment.snapshot.id !== attachmentId);
		if (next.length === existing.length) {
			throw new ImageAttachmentNotFound({
				workspaceId,
				sessionId,
				attachmentId,
				message: "Image attachment is not available",
			});
		}
		this.attachmentsBySession.set(key, next);
		return this.snapshot(workspaceId, sessionId);
	}

	clear(workspaceId: WorkspaceId, sessionId: SessionId): ImageAttachmentListSnapshot {
		this.attachmentsBySession.delete(createRuntimeSessionKey(workspaceId, sessionId));
		return this.snapshot(workspaceId, sessionId);
	}

	clearSession(workspaceId: WorkspaceId, sessionId: SessionId): void {
		this.attachmentsBySession.delete(createRuntimeSessionKey(workspaceId, sessionId));
	}

	async consumeForSend(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		attachmentIds: readonly string[],
	): Promise<ImageContent[]> {
		await this.assertImagesAllowed(workspaceId, sessionId);
		return this.consume(workspaceId, sessionId, attachmentIds);
	}

	consume(workspaceId: WorkspaceId, sessionId: SessionId, attachmentIds: readonly string[]): ImageContent[] {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		const existing = this.attachmentsBySession.get(key) ?? [];
		const images: ImageContent[] = [];
		const remaining: StoredImageAttachment[] = [];
		const requestedIds = new Set(attachmentIds);
		for (const attachment of existing) {
			if (!requestedIds.has(attachment.snapshot.id)) {
				remaining.push(attachment);
				continue;
			}
			images.push({ type: "image", data: attachment.data, mimeType: attachment.mimeType });
			requestedIds.delete(attachment.snapshot.id);
		}
		const missingId = requestedIds.values().next().value;
		if (typeof missingId === "string") {
			throw new ImageAttachmentNotFound({
				workspaceId,
				sessionId,
				attachmentId: missingId,
				message: "Image attachment is not available",
			});
		}
		if (remaining.length === 0) this.attachmentsBySession.delete(key);
		else this.attachmentsBySession.set(key, remaining);
		return images;
	}

	private async assertImagesAllowed(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
		const settings = await this.getImageSettings(workspaceId);
		if (!settings.blockImages) return;
		throw new ImageAttachmentBlocked({
			workspaceId,
			sessionId,
			message: "Image attachments are blocked by Pi image settings",
		});
	}

	private async createFromFile(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		filePath: string,
		sourceSizeBytes: number,
	): Promise<StoredImageAttachment> {
		let mimeType: string | null;
		try {
			mimeType = await detectSupportedImageMimeTypeFromFile(filePath);
		} catch (error) {
			throw new ImageAttachmentReadFailed({
				workspaceId,
				sessionId,
				filePath,
				message: "Failed to read image file",
				cause: getErrorMessage(error),
			});
		}
		if (!isSupportedMimeType(mimeType)) {
			throw new ImageAttachmentUnsupportedMime({
				workspaceId,
				sessionId,
				filePath,
				...(mimeType ? { mimeType } : {}),
				message: "Image file type is not supported",
			});
		}
		try {
			const buffer = await readFile(filePath);
			return await this.createStoredAttachment({
				workspaceId,
				sessionId,
				source: "file",
				fileName: basename(filePath),
				filePath,
				mimeType,
				buffer,
				sourceSizeBytes,
			});
		} catch (error) {
			if (
				error instanceof ImageAttachmentReadFailed ||
				error instanceof ImageAttachmentResizeFailed ||
				error instanceof ImageAttachmentUnsupportedMime
			) {
				throw error;
			}
			throw new ImageAttachmentReadFailed({
				workspaceId,
				sessionId,
				filePath,
				message: "Failed to read image file",
				cause: getErrorMessage(error),
			});
		}
	}

	private async createStoredAttachment(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		source: ImageAttachmentSnapshot["source"];
		fileName: string | undefined;
		filePath?: string;
		mimeType: SupportedImageMimeType;
		buffer: Buffer;
		sourceSizeBytes: number;
	}): Promise<StoredImageAttachment> {
		const settings = await this.getImageSettings(request.workspaceId);
		let data = request.buffer.toString("base64");
		let mimeType = request.mimeType;
		let dimensionNote: string | undefined;
		if (settings.autoResize) {
			try {
				const resized = await resizeImage(request.buffer, request.mimeType);
				if (!resized) {
					throw new Error("Image could not be resized below the inline image size limit");
				}
				data = resized.data;
				if (!isSupportedMimeType(resized.mimeType)) {
					throw new Error(`Resized image produced unsupported MIME type ${resized.mimeType}`);
				}
				mimeType = resized.mimeType;
				dimensionNote = formatDimensionNote(resized);
			} catch (error) {
				throw new ImageAttachmentResizeFailed({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					filePath: request.filePath,
					message: "Failed to resize image attachment",
					cause: getErrorMessage(error),
				});
			}
		}
		const preview = await this.createPreviewDataUrl(request);
		return {
			data,
			mimeType,
			sourceSizeBytes: request.sourceSizeBytes,
			snapshot: {
				id: `image-${randomUUID()}`,
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				source: request.source,
				...(request.fileName ? { fileName: request.fileName } : {}),
				mimeType,
				sizeBytes: request.sourceSizeBytes,
				previewDataUrl: preview,
				...(dimensionNote ? { dimensionNote } : {}),
				createdAt: this.now().toISOString(),
			},
		};
	}

	private async createPreviewDataUrl(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		filePath?: string;
		mimeType: SupportedImageMimeType;
		buffer: Buffer;
	}): Promise<string> {
		if (request.buffer.byteLength <= MAX_PREVIEW_BYTES) {
			return `data:${request.mimeType};base64,${request.buffer.toString("base64")}`;
		}
		try {
			const resized = await resizeImage(request.buffer, request.mimeType, {
				maxWidth: MAX_PREVIEW_DIMENSION,
				maxHeight: MAX_PREVIEW_DIMENSION,
				maxBytes: MAX_PREVIEW_BYTES,
			});
			if (!resized) {
				throw new Error("Image could not be resized below the preview size limit");
			}
			if (!isSupportedMimeType(resized.mimeType)) {
				throw new Error(`Preview image produced unsupported MIME type ${resized.mimeType}`);
			}
			return `data:${resized.mimeType};base64,${resized.data}`;
		} catch (error) {
			throw new ImageAttachmentResizeFailed({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				filePath: request.filePath,
				message: "Failed to create image attachment preview",
				cause: getErrorMessage(error),
			});
		}
	}

	private async statSourceBytes(workspaceId: WorkspaceId, sessionId: SessionId, filePath: string): Promise<number> {
		try {
			return (await stat(filePath)).size;
		} catch (error) {
			throw new ImageAttachmentReadFailed({
				workspaceId,
				sessionId,
				filePath,
				message: "Failed to read image file metadata",
				cause: getErrorMessage(error),
			});
		}
	}

	private append(workspaceId: WorkspaceId, sessionId: SessionId, attachments: readonly StoredImageAttachment[]): void {
		const key = createRuntimeSessionKey(workspaceId, sessionId);
		this.attachmentsBySession.set(key, [...(this.attachmentsBySession.get(key) ?? []), ...attachments]);
	}

	private snapshot(workspaceId: WorkspaceId, sessionId: SessionId): ImageAttachmentListSnapshot {
		return {
			workspaceId,
			sessionId,
			attachments: (this.attachmentsBySession.get(createRuntimeSessionKey(workspaceId, sessionId)) ?? []).map(
				(attachment) => attachment.snapshot,
			),
		};
	}

	private assertCanAppendCount(workspaceId: WorkspaceId, sessionId: SessionId, incomingCount: number): void {
		const currentCount = this.attachmentsBySession.get(createRuntimeSessionKey(workspaceId, sessionId))?.length ?? 0;
		if (currentCount + incomingCount <= MAX_ATTACHMENTS_PER_SESSION) return;
		throw new ImageAttachmentLimitExceeded({
			workspaceId,
			sessionId,
			maxAttachments: MAX_ATTACHMENTS_PER_SESSION,
			message: `A session can keep at most ${MAX_ATTACHMENTS_PER_SESSION} pending image attachments`,
		});
	}

	private assertSessionBytesWithinLimit(workspaceId: WorkspaceId, sessionId: SessionId, incomingBytes: number): void {
		const currentBytes = (
			this.attachmentsBySession.get(createRuntimeSessionKey(workspaceId, sessionId)) ?? []
		).reduce((total, attachment) => total + attachment.sourceSizeBytes, 0);
		if (currentBytes + incomingBytes <= MAX_SESSION_IMAGE_SOURCE_BYTES) return;
		throw new ImageAttachmentTooLarge({
			workspaceId,
			sessionId,
			sizeBytes: currentBytes + incomingBytes,
			maxBytes: MAX_SESSION_IMAGE_SOURCE_BYTES,
			message: "Pending image attachments exceed the session image size limit",
		});
	}
}

function assertSourceSizeWithinLimit(
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	sizeBytes: number,
	filePath: string | undefined,
): void {
	if (sizeBytes <= MAX_IMAGE_SOURCE_BYTES) return;
	throw new ImageAttachmentTooLarge({
		workspaceId,
		sessionId,
		filePath,
		sizeBytes,
		maxBytes: MAX_IMAGE_SOURCE_BYTES,
		message: "Image attachment exceeds the per-file image size limit",
	});
}

function isSupportedMimeType(mimeType: string | null): mimeType is SupportedImageMimeType {
	return (
		mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/gif" || mimeType === "image/webp"
	);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
