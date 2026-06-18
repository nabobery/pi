import { useState } from "react";
import type { FormEvent } from "react";
import type {
	SessionCatalogSnapshot,
	SessionSnapshot,
	TimelineSnapshot,
	WorkspaceSnapshot,
} from "../../contracts/index.ts";
import type { GuiCatalogStore } from "./app-store.ts";

export function WorkspaceSection({
	store,
	workspaces,
	selectedWorkspace,
}: {
	store: GuiCatalogStore;
	workspaces: readonly WorkspaceSnapshot[];
	selectedWorkspace: WorkspaceSnapshot | undefined;
}) {
	return (
		<div className="sidebar-section">
			<div className="section-row">
				<p className="section-label">Workspace</p>
				<button type="button" onClick={() => void store.pickWorkspaceDirectory()}>
					Add
				</button>
			</div>
			{workspaces.length === 0 ? <p className="empty-copy">No workspace open.</p> : null}
			<div className="list" role="list">
				{workspaces.map((workspace) => (
					<button
						type="button"
						key={workspace.id}
						className={workspace.id === selectedWorkspace?.id ? "list-row list-row--selected" : "list-row"}
						onClick={() => void store.selectWorkspace(workspace.id)}
					>
						<span>{workspace.name}</span>
						<span className={workspace.missing ? "status status--missing" : "status"}>
							{workspace.missing ? "Missing" : "Ready"}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

export function SessionSection({
	store,
	pending,
	selectedWorkspace,
	sessionCatalog,
}: {
	store: GuiCatalogStore;
	pending: boolean;
	selectedWorkspace: WorkspaceSnapshot | undefined;
	sessionCatalog: SessionCatalogSnapshot | undefined;
}) {
	if (!selectedWorkspace) {
		return (
			<div className="sidebar-section">
				<p className="section-label">Sessions</p>
				<p className="empty-copy">Select a workspace.</p>
			</div>
		);
	}

	if (selectedWorkspace.missing) {
		return (
			<div className="sidebar-section">
				<div className="section-row">
					<p className="section-label">Sessions</p>
					<button type="button" onClick={() => void store.syncWorkspace(selectedWorkspace.id)}>
						Sync
					</button>
				</div>
				<p className="empty-copy">Workspace path is missing.</p>
			</div>
		);
	}

	const sessions = sessionCatalog?.sessions ?? [];
	const activeSessions = sessions.filter((session) => !session.archivedAt);
	const archivedSessions = sessions.filter((session) => session.archivedAt);

	return (
		<div className="sidebar-section">
			<div className="section-row">
				<p className="section-label">Sessions</p>
				<div className="button-group">
					<button type="button" disabled={pending} onClick={() => void store.syncWorkspace(selectedWorkspace.id)}>
						Sync
					</button>
					<button type="button" disabled={pending} onClick={() => void store.createSession(selectedWorkspace.id)}>
						New
					</button>
				</div>
			</div>
			{sessions.length === 0 ? <p className="empty-copy">No sessions.</p> : null}
			<SessionList
				store={store}
				sessions={activeSessions}
				selectedSessionId={sessionCatalog?.selectedSessionId}
				isArchived={false}
			/>
			{archivedSessions.length > 0 ? (
				<details className="archive-group">
					<summary>Archived ({archivedSessions.length})</summary>
					<SessionList
						store={store}
						sessions={archivedSessions}
						selectedSessionId={sessionCatalog?.selectedSessionId}
						isArchived
					/>
				</details>
			) : null}
		</div>
	);
}

export function MainPane({
	session,
	timeline,
}: {
	session: SessionSnapshot | undefined;
	timeline: TimelineSnapshot | undefined;
}) {
	if (!session) {
		return (
			<div className="timeline">
				<p className="empty-title">No active session</p>
				<p className="empty-copy">Open or create a session.</p>
			</div>
		);
	}

	return (
		<div className="timeline timeline--details">
			<dl className="metadata-grid">
				<div>
					<dt>Status</dt>
					<dd>{session.status}</dd>
				</div>
				<div>
					<dt>Updated</dt>
					<dd>{formatTime(session.updatedAt)}</dd>
				</div>
				<div>
					<dt>Messages</dt>
					<dd>{session.messageCount}</dd>
				</div>
			</dl>
			{timeline && timeline.entries.length > 0 ? (
				<div className="transcript-list" role="log" aria-label="Transcript">
					{timeline.entries.map((entry) => (
						<article key={entry.id} className={`transcript-entry transcript-entry--${entry.kind}`}>
							<p className="transcript-kind">{entry.kind}</p>
							<p>{entry.text}</p>
						</article>
					))}
				</div>
			) : (
				<>
					<p className="empty-title">No transcript yet</p>
					<p className="empty-copy">{session.sessionFilePath ?? "Session file path unavailable."}</p>
				</>
			)}
		</div>
	);
}

function SessionList({
	store,
	sessions,
	selectedSessionId,
	isArchived,
}: {
	store: GuiCatalogStore;
	sessions: readonly SessionSnapshot[];
	selectedSessionId: string | undefined;
	isArchived: boolean;
}) {
	const [editingSessionId, setEditingSessionId] = useState<string | undefined>();
	const [draftTitle, setDraftTitle] = useState("");

	function startRename(session: SessionSnapshot): void {
		setEditingSessionId(session.id);
		setDraftTitle(session.title);
	}

	function cancelRename(): void {
		setEditingSessionId(undefined);
		setDraftTitle("");
	}

	function submitRename(event: FormEvent<HTMLFormElement>, session: SessionSnapshot): void {
		event.preventDefault();
		const nextTitle = draftTitle.trim();
		if (!nextTitle) return;
		cancelRename();
		void store.renameSession(session.workspaceId, session.id, nextTitle);
	}

	return (
		<div className="list" role="list">
			{sessions.map((session) => (
				<div
					key={`${session.workspaceId}:${session.id}`}
					className={session.id === selectedSessionId ? "session-row session-row--selected" : "session-row"}
				>
					<button
						type="button"
						className="session-open"
						onClick={() => void store.openSession(session.workspaceId, session.id)}
					>
						<span>{session.title}</span>
						<span className="session-preview">{session.preview || formatTime(session.updatedAt)}</span>
						<span className="session-meta">
							{session.status} - {session.messageCount} messages
						</span>
					</button>
					{editingSessionId === session.id ? (
						<form className="rename-form" onSubmit={(event) => submitRename(event, session)}>
							<input
								aria-label="Session title"
								value={draftTitle}
								onChange={(event) => setDraftTitle(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") cancelRename();
								}}
							/>
							<button type="submit" className="row-action" disabled={!draftTitle.trim()}>
								Save
							</button>
							<button type="button" className="row-action" onClick={cancelRename}>
								Cancel
							</button>
						</form>
					) : (
						<button type="button" className="row-action" onClick={() => startRename(session)}>
							Rename
						</button>
					)}
					<button
						type="button"
						className="row-action"
						onClick={() => {
							if (isArchived) {
								void store.unarchiveSession(session.workspaceId, session.id);
								return;
							}
							void store.archiveSession(session.workspaceId, session.id);
						}}
					>
						{isArchived ? "Restore" : "Archive"}
					</button>
				</div>
			))}
		</div>
	);
}

function formatTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
