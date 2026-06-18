import type { SessionId, TimelineSnapshot, WorkspaceId } from "../../contracts/index.ts";

type TimelineEntryKind = TimelineSnapshot["entries"][number]["kind"];

interface ProjectableMessage {
	role?: string;
	content?: unknown;
}

interface ProjectableEntry {
	id?: string;
	type?: string;
	message?: ProjectableMessage;
	summary?: string;
	content?: unknown;
}

export function projectTimelineSnapshot(
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	entries: readonly unknown[],
): TimelineSnapshot {
	return {
		workspaceId,
		sessionId,
		entries: entries
			.map((entry, index) => projectEntry(toProjectableEntry(entry), index))
			.filter((entry): entry is TimelineSnapshot["entries"][number] => Boolean(entry)),
	};
}

function toProjectableEntry(entry: unknown): ProjectableEntry {
	if (typeof entry !== "object" || entry === null) return {};
	return entry;
}

function projectEntry(entry: ProjectableEntry, index: number): TimelineSnapshot["entries"][number] | undefined {
	const id = entry.id ?? `entry-${index}`;
	if (entry.message) {
		return {
			id,
			kind: roleToKind(entry.message.role),
			text: extractText(entry.message.content),
		};
	}
	if (typeof entry.summary === "string" && entry.summary.length > 0) {
		return { id, kind: "system", text: entry.summary };
	}
	const text = extractText(entry.content);
	if (text.length === 0) return undefined;
	return { id, kind: "system", text };
}

function roleToKind(role: string | undefined): TimelineEntryKind {
	if (role === "user") return "user";
	if (role === "assistant") return "assistant";
	if (role === "tool") return "tool";
	return "system";
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (!isTextPart(part)) return "";
			return part.text;
		})
		.join("");
}

function isTextPart(value: unknown): value is { text: string } {
	return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}
