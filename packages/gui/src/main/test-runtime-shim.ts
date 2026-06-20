import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const IMAGE_TYPE_SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface ResizedImage {
	data: string;
	height: number;
	mimeType: string;
	originalHeight: number;
	originalWidth: number;
	wasResized: boolean;
	width: number;
}

export function getAgentDir(): string {
	return join(process.env.HOME ?? homedir(), ".pi");
}

export function getShareViewerUrl(gistId: string): string {
	return `https://pi.dev/session/#${gistId}`;
}

export async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
	const fileHandle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(IMAGE_TYPE_SNIFF_BYTES);
		const { bytesRead } = await fileHandle.read(buffer, 0, IMAGE_TYPE_SNIFF_BYTES, 0);
		return detectSupportedImageMimeType(buffer.subarray(0, bytesRead));
	} finally {
		await fileHandle.close();
	}
}

function detectSupportedImageMimeType(buffer: Uint8Array): string | null {
	if (startsWith(buffer, [0xff, 0xd8, 0xff])) return buffer[3] === 0xf7 ? null : "image/jpeg";
	if (startsWith(buffer, PNG_SIGNATURE)) return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : null;
	if (startsWithAscii(buffer, 0, "GIF")) return "image/gif";
	if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) return "image/webp";
	return null;
}

export async function resizeImage(inputBytes: Uint8Array, mimeType: string): Promise<ResizedImage> {
	return {
		data: Buffer.from(inputBytes).toString("base64"),
		height: 1,
		mimeType,
		originalHeight: 1,
		originalWidth: 1,
		wasResized: false,
		width: 1,
	};
}

export function formatDimensionNote(result: ResizedImage): string | undefined {
	if (!result.wasResized) return undefined;
	const scale = result.originalWidth / result.width;
	return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}

export class ProjectTrustStore {
	getEntry(): undefined {
		return undefined;
	}
}

export class SettingsManager {
	static create(): SettingsManager {
		return new SettingsManager();
	}

	drainErrors(): Array<{ error: Error; scope: string }> {
		return [];
	}

	getDefaultProvider(): string | undefined {
		return undefined;
	}

	getDefaultModel(): string | undefined {
		return undefined;
	}

	getDefaultThinkingLevel(): string | undefined {
		return undefined;
	}

	getEnableSkillCommands(): boolean {
		return true;
	}

	getSteeringMode(): "all" {
		return "all";
	}

	getFollowUpMode(): "all" {
		return "all";
	}

	getDefaultProjectTrust(): "ask" {
		return "ask";
	}
}

export const SessionManager = {
	async list(): Promise<[]> {
		return [];
	},

	open(): never {
		throw new Error("Pi SDK SessionManager is unavailable in GUI E2E fake-runtime builds");
	},
};

export function getDefaultSessionDir(cwd: string): string {
	return join(cwd, ".pi", "sessions");
}

export function filterAndSortSessions<T>(sessions: T[]): T[] {
	return sessions;
}

export const BUILTIN_SLASH_COMMANDS = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "new", description: "Start a new session" },
] as const;

export function getProjectTrustOptions(): [] {
	return [];
}

export function hasTrustRequiringProjectResources(): boolean {
	return false;
}

export function getSupportedThinkingLevels(): ["off"] {
	return ["off"];
}

export function createAgentSessionRuntime(): never {
	throw new Error("Pi SDK runtime is unavailable in GUI E2E fake-runtime builds");
}

export function createAgentSessionServices(): never {
	throw new Error("Pi SDK services are unavailable in GUI E2E fake-runtime builds");
}

export function createAgentSessionFromServices(): never {
	throw new Error("Pi SDK session is unavailable in GUI E2E fake-runtime builds");
}

function startsWith(buffer: Uint8Array, bytes: readonly number[]): boolean {
	if (buffer.length < bytes.length) return false;
	return bytes.every((byte, index) => buffer[index] === byte);
}

function isPng(buffer: Uint8Array): boolean {
	return (
		buffer.length >= 16 && readUint32BE(buffer, PNG_SIGNATURE.length) === 13 && startsWithAscii(buffer, 12, "IHDR")
	);
}

function isAnimatedPng(buffer: Uint8Array): boolean {
	let offset = PNG_SIGNATURE.length;
	while (offset + 8 <= buffer.length) {
		const chunkLength = readUint32BE(buffer, offset);
		const chunkTypeOffset = offset + 4;
		if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;
		if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;

		const nextOffset = offset + 8 + chunkLength + 4;
		if (nextOffset <= offset || nextOffset > buffer.length) return false;
		offset = nextOffset;
	}
	return false;
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
	return (
		(buffer[offset] ?? 0) * 0x1000000 +
		((buffer[offset + 1] ?? 0) << 16) +
		((buffer[offset + 2] ?? 0) << 8) +
		(buffer[offset + 3] ?? 0)
	);
}

function startsWithAscii(buffer: Uint8Array, offset: number, text: string): boolean {
	if (buffer.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index++) {
		if (buffer[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}
