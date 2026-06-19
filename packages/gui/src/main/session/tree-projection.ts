import type {
	SessionId,
	SessionTreeEntrySnapshot,
	SessionTreeSnapshot,
	TreeEntryKind,
	WorkspaceId,
} from "../../contracts/index.ts";

export interface ProjectSessionTreeSnapshotRequest {
	getLabel?(entryId: string): string | undefined;
	leafEntryId: string | null | undefined;
	now?: () => Date;
	sessionId: SessionId;
	tree: readonly PiSessionTreeNode[];
	workspaceId: WorkspaceId;
}

export interface PiSessionTreeNode {
	entry: unknown;
	children: readonly PiSessionTreeNode[];
	label?: string;
	labelTimestamp?: string;
}

export function projectSessionTreeSnapshot(request: ProjectSessionTreeSnapshotRequest): SessionTreeSnapshot {
	const leafEntryId = request.leafEntryId ?? null;
	const activePath = new Set<string>();
	collectActivePath(request.tree, leafEntryId, [], activePath);
	const entries: SessionTreeEntrySnapshot[] = [];
	for (const root of request.tree) {
		projectNode({
			activePath,
			depth: 0,
			entries,
			getLabel: request.getLabel,
			leafEntryId,
			node: root,
			parentId: null,
		});
	}
	return {
		workspaceId: request.workspaceId,
		sessionId: request.sessionId,
		leafEntryId,
		entries,
		updatedAt: (request.now ?? (() => new Date()))().toISOString(),
	};
}

function projectNode(request: {
	activePath: ReadonlySet<string>;
	depth: number;
	entries: SessionTreeEntrySnapshot[];
	getLabel: ProjectSessionTreeSnapshotRequest["getLabel"];
	leafEntryId: string | null;
	node: PiSessionTreeNode;
	parentId: string | null;
}): void {
	const entry = asRecord(request.node.entry);
	const entryId = getEntryId(entry);
	if (!entryId) return;
	const kind = getEntryKind(entry);
	const textPreview = getTextPreview(entry, kind);
	const label = request.node.label ?? request.getLabel?.(entryId);
	const childIds = request.node.children.map((child) => getEntryId(asRecord(child.entry))).filter(isString);
	const snapshot: SessionTreeEntrySnapshot = {
		entryId,
		parentId: getParentId(entry) ?? request.parentId,
		childIds,
		depth: request.depth,
		kind,
		textPreview,
		...(label ? { label } : {}),
		...(request.node.labelTimestamp ? { labelTimestamp: request.node.labelTimestamp } : {}),
		isActiveLeaf: entryId === request.leafEntryId,
		isActivePath: request.activePath.has(entryId),
		hasChildren: request.node.children.length > 0,
		searchText: [kind, textPreview, label].filter(isString).join(" "),
	};
	request.entries.push(snapshot);
	for (const child of request.node.children) {
		projectNode({
			...request,
			depth: request.depth + 1,
			node: child,
			parentId: entryId,
		});
	}
}

function collectActivePath(
	nodes: readonly PiSessionTreeNode[],
	leafEntryId: string | null,
	path: readonly string[],
	activePath: Set<string>,
): boolean {
	if (!leafEntryId) return false;
	for (const node of nodes) {
		const entryId = getEntryId(asRecord(node.entry));
		if (!entryId) continue;
		const nextPath = [...path, entryId];
		if (entryId === leafEntryId || collectActivePath(node.children, leafEntryId, nextPath, activePath)) {
			for (const pathEntryId of nextPath) activePath.add(pathEntryId);
			return true;
		}
	}
	return false;
}

function getEntryKind(entry: Readonly<Record<string, unknown>>): TreeEntryKind {
	const type = stringField(entry, "type");
	if (type === "compaction") return "compaction";
	if (type === "branch_summary") return "branchSummary";
	if (type === "tool_result") return "tool";
	if (type === "custom" || type === "custom_message") return "custom";
	if (type === "message") {
		const role = getMessageRole(entry);
		if (role === "user" || role === "assistant" || role === "system") return role;
		if (role === "tool") return "tool";
	}
	return "unknown";
}

function getTextPreview(entry: Readonly<Record<string, unknown>>, kind: TreeEntryKind): string {
	if (kind === "compaction") return preview(stringField(entry, "summary") ?? "");
	if (kind === "branchSummary") return preview(stringField(entry, "summary") ?? "");
	if (kind === "tool") {
		const name = stringField(entry, "toolName") ?? stringField(entry, "name") ?? "tool";
		const output =
			stringField(entry, "output") ?? stringField(entry, "result") ?? stringField(entry, "content") ?? "";
		return preview(`${name}: ${output}`);
	}
	const content = entry.message ? asRecord(entry.message).content : entry.content;
	return preview(extractText(content));
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("");
	const record = asRecord(value);
	if (typeof record.text === "string") return record.text;
	if (typeof record.content === "string") return record.content;
	return "";
}

function getEntryId(entry: Readonly<Record<string, unknown>>): string | undefined {
	return stringField(entry, "id") ?? stringField(entry, "uuid");
}

function getParentId(entry: Readonly<Record<string, unknown>>): string | null | undefined {
	const parentId = entry.parentId ?? entry.parentUuid;
	if (parentId === null) return null;
	return typeof parentId === "string" ? parentId : undefined;
}

function getMessageRole(entry: Readonly<Record<string, unknown>>): string | undefined {
	const directRole = stringField(entry, "role");
	if (directRole) return directRole;
	return stringField(asRecord(entry.message), "role");
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function preview(text: string): string {
	return text.trim().replace(/\s+/g, " ").slice(0, 220);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value === "object" && value !== null) return value as Readonly<Record<string, unknown>>;
	return {};
}

function isString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
