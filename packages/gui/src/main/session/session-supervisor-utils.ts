import {
	SessionFileMissing,
	SessionRuntimeNotFound,
	type SessionCatalogSnapshot,
	type SessionId,
	type SessionSnapshot,
} from "../../contracts/index.ts";

export function findSelectedSession(catalog: SessionCatalogSnapshot): SessionSnapshot {
	const selectedSessionId = catalog.selectedSessionId ?? catalog.sessions[0]?.id;
	if (selectedSessionId) return findSession(catalog, selectedSessionId);
	throw new SessionFileMissing({ sessionId: "", path: "", message: "Created session was not returned by catalog" });
}

export function findSession(catalog: SessionCatalogSnapshot, sessionId: SessionId): SessionSnapshot {
	const session = catalog.sessions.find((entry) => entry.id === sessionId);
	if (session) return session;
	throw new SessionRuntimeNotFound({
		workspaceId: catalog.workspaceId,
		sessionId,
		message: `Session ${sessionId} was not returned by catalog`,
	});
}

export function withStatus(session: SessionSnapshot, status: SessionSnapshot["status"]): SessionSnapshot {
	return { ...session, status };
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function stringifyEventValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
