import type { SessionInfo } from "./session-manager.ts";

export type SortMode = "threaded" | "recent" | "relevance";

export type NameFilter = "all" | "named";

export interface ParsedSearchQuery {
	mode: "tokens" | "regex";
	tokens: { kind: "fuzzy" | "phrase"; value: string }[];
	regex: RegExp | null;
	error?: string;
}

export interface MatchResult {
	matches: boolean;
	score: number;
}

interface SessionTreeNode {
	children: SessionTreeNode[];
	latestModifiedTime: number;
	session: SessionInfo;
}

const MAX_REGEX_PATTERN_LENGTH = 200;
const MAX_SEARCH_TEXT_LENGTH = 200_000;

function normalizeWhitespaceLower(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function getSessionSearchText(session: SessionInfo): string {
	return `${session.id} ${session.name ?? ""} ${session.allMessagesText.slice(0, MAX_SEARCH_TEXT_LENGTH)} ${session.cwd}`;
}

export function hasSessionName(session: SessionInfo): boolean {
	return Boolean(session.name?.trim());
}

function matchesNameFilter(session: SessionInfo, filter: NameFilter): boolean {
	if (filter === "all") return true;
	return hasSessionName(session);
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
	const trimmed = query.trim();
	if (!trimmed) {
		return { mode: "tokens", tokens: [], regex: null };
	}

	if (trimmed.startsWith("re:")) {
		const pattern = trimmed.slice(3).trim();
		if (!pattern) {
			return { mode: "regex", tokens: [], regex: null, error: "Empty regex" };
		}
		if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
			return { mode: "regex", tokens: [], regex: null, error: "Regex is too long" };
		}
		if (isUnsafeRegexPattern(pattern)) {
			return { mode: "regex", tokens: [], regex: null, error: "Unsafe regex" };
		}
		try {
			return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") };
		} catch (error) {
			return {
				mode: "regex",
				tokens: [],
				regex: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	const tokens: ParsedSearchQuery["tokens"] = [];
	let buffer = "";
	let inQuote = false;

	const flush = (kind: "fuzzy" | "phrase"): void => {
		const value = buffer.trim();
		buffer = "";
		if (value) tokens.push({ kind, value });
	};

	for (let index = 0; index < trimmed.length; index += 1) {
		const character = trimmed[index];
		if (character === '"') {
			if (inQuote) {
				flush("phrase");
				inQuote = false;
			} else {
				flush("fuzzy");
				inQuote = true;
			}
			continue;
		}

		if (!inQuote && character && /\s/.test(character)) {
			flush("fuzzy");
			continue;
		}

		buffer += character;
	}

	if (inQuote) {
		return {
			mode: "tokens",
			tokens: trimmed
				.split(/\s+/)
				.map((token) => token.trim())
				.filter((token) => token.length > 0)
				.map((token) => ({ kind: "fuzzy" as const, value: token })),
			regex: null,
		};
	}

	flush("fuzzy");
	return { mode: "tokens", tokens, regex: null };
}

export function matchSession(session: SessionInfo, parsed: ParsedSearchQuery): MatchResult {
	const text = getSessionSearchText(session);

	if (parsed.mode === "regex") {
		if (!parsed.regex) return { matches: false, score: 0 };
		const index = text.search(parsed.regex);
		if (index < 0) return { matches: false, score: 0 };
		return { matches: true, score: index * 0.1 };
	}

	if (parsed.tokens.length === 0) {
		return { matches: true, score: 0 };
	}

	let totalScore = 0;
	let normalizedText: string | undefined;

	for (const token of parsed.tokens) {
		if (token.kind === "phrase") {
			normalizedText ??= normalizeWhitespaceLower(text);
			const phrase = normalizeWhitespaceLower(token.value);
			if (!phrase) continue;
			const index = normalizedText.indexOf(phrase);
			if (index < 0) return { matches: false, score: 0 };
			totalScore += index * 0.1;
			continue;
		}

		const matched = fuzzyMatch(token.value, text);
		if (!matched.matches) return { matches: false, score: 0 };
		totalScore += matched.score;
	}

	return { matches: true, score: totalScore };
}

export function filterAndSortSessions(
	sessions: SessionInfo[],
	query: string,
	sortMode: SortMode,
	nameFilter: NameFilter = "all",
): SessionInfo[] {
	const nameFiltered = sessions.filter((session) => matchesNameFilter(session, nameFilter));
	const trimmed = query.trim();
	if (!trimmed) return sortMode === "recent" ? nameFiltered : sortByThreadOrRecent(nameFiltered, sortMode);

	const parsed = parseSearchQuery(query);
	if (parsed.error) return [];

	if (sortMode === "recent") {
		return nameFiltered.filter((session) => matchSession(session, parsed).matches);
	}

	const scored: { session: SessionInfo; score: number }[] = [];
	for (const session of nameFiltered) {
		const result = matchSession(session, parsed);
		if (result.matches) scored.push({ session, score: result.score });
	}

	scored.sort((left, right) => {
		if (left.score !== right.score) return left.score - right.score;
		return right.session.modified.getTime() - left.session.modified.getTime();
	});

	return scored.map((result) => result.session);
}

function sortByThreadOrRecent(sessions: SessionInfo[], sortMode: SortMode): SessionInfo[] {
	if (sortMode === "recent") return sessions;
	if (sortMode === "threaded") {
		return flattenSessionTree(buildSessionTree(sessions));
	}
	return [...sessions].sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

function fuzzyMatch(pattern: string, text: string): MatchResult {
	const queryLower = pattern.toLowerCase();
	const textLower = text.toLowerCase();

	const matchQuery = (normalizedQuery: string): MatchResult => {
		if (normalizedQuery.length === 0) return { matches: true, score: 0 };
		if (normalizedQuery.length > textLower.length) return { matches: false, score: 0 };

		let queryIndex = 0;
		let score = 0;
		let lastMatchIndex = -1;
		let consecutiveMatches = 0;

		for (let index = 0; index < textLower.length && queryIndex < normalizedQuery.length; index += 1) {
			if (textLower[index] !== normalizedQuery[queryIndex]) continue;
			const isWordBoundary = index === 0 || /[\s\-_./:]/.test(textLower[index - 1] ?? "");
			if (lastMatchIndex === index - 1) {
				consecutiveMatches += 1;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				if (lastMatchIndex >= 0) score += (index - lastMatchIndex - 1) * 2;
			}
			if (isWordBoundary) score -= 10;
			score += index * 0.1;
			lastMatchIndex = index;
			queryIndex += 1;
		}

		if (queryIndex < normalizedQuery.length) return { matches: false, score: 0 };
		if (normalizedQuery === textLower) score -= 100;
		return { matches: true, score };
	};

	const primaryMatch = matchQuery(queryLower);
	if (primaryMatch.matches) return primaryMatch;

	const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
	const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
	const swappedQuery = alphaNumericMatch
		? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}`
		: numericAlphaMatch
			? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}`
			: "";
	if (!swappedQuery) return primaryMatch;
	const swappedMatch = matchQuery(swappedQuery);
	if (!swappedMatch.matches) return primaryMatch;
	return { matches: true, score: swappedMatch.score + 5 };
}

function isUnsafeRegexPattern(pattern: string): boolean {
	return /(\([^)]*[+*][^)]*\)\s*[+*?{])/.test(pattern);
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
	const byPath = new Map<string, SessionTreeNode>();
	for (const session of sessions) {
		byPath.set(session.path, { session, children: [], latestModifiedTime: session.modified.getTime() });
	}

	const roots: SessionTreeNode[] = [];
	for (const session of sessions) {
		const node = byPath.get(session.path);
		if (!node) continue;
		const parent = session.parentSessionPath ? byPath.get(session.parentSessionPath) : undefined;
		if (parent) {
			parent.children.push(node);
			continue;
		}
		roots.push(node);
	}

	for (const root of roots) updateLatestModifiedTime(root);
	sortTree(roots);
	return roots;
}

function updateLatestModifiedTime(node: SessionTreeNode): number {
	let latestModifiedTime = node.session.modified.getTime();
	for (const child of node.children) {
		latestModifiedTime = Math.max(latestModifiedTime, updateLatestModifiedTime(child));
	}
	node.latestModifiedTime = latestModifiedTime;
	return latestModifiedTime;
}

function sortTree(nodes: SessionTreeNode[]): void {
	nodes.sort((left, right) => right.latestModifiedTime - left.latestModifiedTime);
	for (const node of nodes) sortTree(node.children);
}

function flattenSessionTree(nodes: SessionTreeNode[]): SessionInfo[] {
	const sessions: SessionInfo[] = [];
	const visit = (node: SessionTreeNode): void => {
		sessions.push(node.session);
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return sessions;
}
