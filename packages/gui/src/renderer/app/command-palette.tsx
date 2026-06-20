import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
	ResumeNameFilter,
	ResumeScope,
	ResumeSortMode,
	SessionId,
	SlashCommandSnapshot,
	WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogViewState, GuiCatalogStore } from "./app-store.ts";
import { ModalDialog } from "./modal-dialog.tsx";

export function CommandPalette({
	selectedSessionId,
	selectedWorkspaceId,
	state,
	store,
}: {
	selectedSessionId: SessionId | undefined;
	selectedWorkspaceId: WorkspaceId | undefined;
	state: CatalogViewState;
	store: GuiCatalogStore;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const selectedKey =
		selectedWorkspaceId && selectedSessionId ? `${selectedWorkspaceId}:${selectedSessionId}` : undefined;
	const catalog = selectedKey ? state.slashCommandCatalogsBySessionKey[selectedKey] : undefined;
	const query = normalizeQuery(state.commandPalette.query);
	const commands = useMemo(() => filterCommands(catalog?.commands ?? [], query), [catalog, query]);
	const selectedIndex = clampIndex(state.commandPalette.selectedIndex, commands.length);

	useEffect(() => {
		if (!state.commandPalette.open) return;
		inputRef.current?.focus();
	}, [state.commandPalette.open]);

	useEffect(() => {
		if (!state.commandPalette.open || !selectedWorkspaceId || !selectedSessionId || catalog) return;
		void store.getSlashCommands(selectedWorkspaceId, selectedSessionId);
	}, [catalog, selectedSessionId, selectedWorkspaceId, state.commandPalette.open, store]);

	if (!state.commandPalette.open) return null;

	function close(): void {
		store.closeCommandPalette();
	}

	function moveSelection(delta: number): void {
		store.setCommandPaletteSelectedIndex(clampIndex(selectedIndex + delta, commands.length));
	}

	function runSelected(): void {
		const command = commands[selectedIndex];
		if (command) runCommand(command);
	}

	function runCommand(command: SlashCommandSnapshot): void {
		if (!selectedWorkspaceId || !selectedSessionId) return;
		if (command.availability === "deferred" || command.availability === "conflict") return;
		if (command.source !== "builtin") {
			store.setComposerDraft(selectedWorkspaceId, selectedSessionId, `/${command.name} `);
			close();
			return;
		}
		if (command.name === "resume") {
			close();
			void store.openResumePicker(selectedWorkspaceId);
			return;
		}
		if (command.name === "new") {
			close();
			void store.createSession(selectedWorkspaceId);
			return;
		}
		if (command.name === "settings") {
			close();
			void store.openControlPlane("settings", selectedWorkspaceId, selectedSessionId);
			return;
		}
		if (command.name === "trust") {
			close();
			void store.openControlPlane("trust", selectedWorkspaceId, selectedSessionId);
			return;
		}
		if (command.name === "model") {
			document.getElementById("runtime-controls")?.focus();
			close();
			return;
		}
		if (command.name === "name") {
			store.requestSessionRename(selectedWorkspaceId, selectedSessionId);
			close();
			return;
		}
		if (command.name === "tree") {
			close();
			store.openTreeNavigator(selectedWorkspaceId, selectedSessionId);
			return;
		}
		if (command.name === "compact") {
			close();
			store.openCompactDialog(selectedWorkspaceId, selectedSessionId);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			moveSelection(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			moveSelection(-1);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			runSelected();
		}
	}

	return (
		<ModalDialog
			className="command-modal"
			initialFocusRef={inputRef}
			labelledBy="command-palette-title"
			onClose={close}
		>
			<p className="eyebrow">Command</p>
			<h3 id="command-palette-title">Slash commands</h3>
			<input
				ref={inputRef}
				aria-controls="command-palette-list"
				aria-expanded="true"
				aria-label="Search slash commands"
				autoComplete="off"
				placeholder="/"
				role="combobox"
				value={state.commandPalette.query}
				onChange={(event) => store.setCommandPaletteQuery(event.currentTarget.value)}
				onKeyDown={handleKeyDown}
			/>
			{state.commandPalette.error ? <p className="inline-error">{state.commandPalette.error}</p> : null}
			<div id="command-palette-list" className="command-list" role="listbox">
				{state.commandPalette.loading ? <p className="empty-copy">Loading commands.</p> : null}
				{!state.commandPalette.loading && commands.length === 0 ? (
					<p className="empty-copy">No commands found.</p>
				) : null}
				{commands.map((command, index) => (
					<button
						type="button"
						key={`${command.source}:${command.name}`}
						aria-selected={index === selectedIndex}
						className={index === selectedIndex ? "command-row command-row--selected" : "command-row"}
						disabled={command.availability === "deferred" || command.availability === "conflict"}
						role="option"
						onClick={() => runCommand(command)}
					>
						<span className="command-row__main">
							<span>/{command.name}</span>
							<span>{command.description ?? command.disabledReason ?? "No description."}</span>
						</span>
						<span className="command-row__meta">{command.source}</span>
					</button>
				))}
			</div>
		</ModalDialog>
	);
}

export function ResumePicker({
	selectedWorkspaceId,
	state,
	store,
}: {
	selectedWorkspaceId: WorkspaceId | undefined;
	state: CatalogViewState;
	store: GuiCatalogStore;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [renameSessionId, setRenameSessionId] = useState<SessionId | undefined>();
	const [renameTitle, setRenameTitle] = useState("");
	const [queryDraft, setQueryDraft] = useState(state.resumePicker.query);
	const result = state.resumePicker.result;
	const sessions = result?.results ?? [];
	const selectedIndex = clampIndex(state.resumePicker.selectedIndex, sessions.length);

	useEffect(() => {
		if (!state.resumePicker.open) return;
		inputRef.current?.focus();
	}, [state.resumePicker.open]);

	useEffect(() => {
		if (!state.resumePicker.open) return;
		setQueryDraft(state.resumePicker.query);
	}, [state.resumePicker.open, state.resumePicker.query]);

	useEffect(() => {
		if (!state.resumePicker.open || !selectedWorkspaceId) return;
		if (queryDraft === state.resumePicker.query) return;
		const timeout = window.setTimeout(() => {
			void store.searchResume(selectedWorkspaceId, { query: queryDraft });
		}, 180);
		return () => {
			window.clearTimeout(timeout);
		};
	}, [queryDraft, selectedWorkspaceId, state.resumePicker.open, state.resumePicker.query, store]);

	if (!state.resumePicker.open || !selectedWorkspaceId) return null;
	const activeWorkspaceId = selectedWorkspaceId;

	function updateSearch(
		patch: Partial<
			Pick<CatalogViewState["resumePicker"], "includeArchived" | "nameFilter" | "query" | "scope" | "sortMode">
		>,
	): void {
		void store.searchResume(activeWorkspaceId, patch);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === "Escape") {
			event.preventDefault();
			store.closeResumePicker();
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			store.setResumePickerSelectedIndex(clampIndex(selectedIndex + 1, sessions.length));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			store.setResumePickerSelectedIndex(clampIndex(selectedIndex - 1, sessions.length));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const session = sessions[selectedIndex];
			if (session) void store.resumeOpenSession(session.workspaceId, session.sessionId);
		}
	}

	return (
		<ModalDialog
			className="command-modal"
			initialFocusRef={inputRef}
			labelledBy="resume-picker-title"
			onClose={() => store.closeResumePicker()}
		>
			<div className="modal-title-row">
				<div>
					<p className="eyebrow">Resume</p>
					<h3 id="resume-picker-title">Resume session</h3>
				</div>
				<button type="button" onClick={() => store.closeResumePicker()}>
					Close
				</button>
			</div>
			<input
				ref={inputRef}
				aria-controls="resume-picker-list"
				aria-expanded="true"
				aria-label="Search sessions"
				autoComplete="off"
				placeholder="Search sessions"
				role="combobox"
				value={queryDraft}
				onChange={(event) => setQueryDraft(event.currentTarget.value)}
				onKeyDown={handleKeyDown}
			/>
			<div className="picker-controls">
				<SelectControl
					label="Scope"
					value={state.resumePicker.scope}
					values={["currentWorkspace", "knownWorkspaces"]}
					onChange={(value) => updateSearch({ scope: value as ResumeScope })}
				/>
				<SelectControl
					label="Sort"
					value={state.resumePicker.sortMode}
					values={["threaded", "recent", "relevance"]}
					onChange={(value) => updateSearch({ sortMode: value as ResumeSortMode })}
				/>
				<SelectControl
					label="Name"
					value={state.resumePicker.nameFilter}
					values={["all", "named"]}
					onChange={(value) => updateSearch({ nameFilter: value as ResumeNameFilter })}
				/>
				<label className="toggle-control">
					<input
						type="checkbox"
						checked={state.resumePicker.includeArchived}
						onChange={(event) => updateSearch({ includeArchived: event.currentTarget.checked })}
					/>
					Archived
				</label>
				<label className="toggle-control">
					<input
						type="checkbox"
						checked={state.resumePicker.showPaths}
						onChange={(event) => store.setResumePickerShowPaths(event.currentTarget.checked)}
					/>
					Path
				</label>
			</div>
			{state.resumePicker.error ? <p className="inline-error">{state.resumePicker.error}</p> : null}
			<div id="resume-picker-list" className="command-list command-list--tall" role="listbox">
				{state.resumePicker.loading ? <p className="empty-copy">Loading sessions.</p> : null}
				{!state.resumePicker.loading && sessions.length === 0 ? (
					<p className="empty-copy">No sessions found.</p>
				) : null}
				{sessions.map((session, index) => (
					<div
						key={`${session.workspaceId}:${session.sessionId}`}
						aria-selected={index === selectedIndex}
						className={index === selectedIndex ? "resume-row resume-row--selected" : "resume-row"}
						role="option"
					>
						<button
							type="button"
							className="resume-row__open"
							onClick={() => void store.resumeOpenSession(session.workspaceId, session.sessionId)}
						>
							<span className="session-title-line">
								<span>{session.title}</span>
								<span className="session-badges">
									{session.isOpen ? <span className="session-badge">Open</span> : null}
									{session.isRunning ? <span className="session-badge">Running</span> : null}
									{session.archivedAt ? <span className="session-badge">Archived</span> : null}
								</span>
							</span>
							<span className="session-preview">{session.preview || session.workspaceName}</span>
							<span className="session-meta">
								{session.workspaceName} - {session.messageCount} messages
							</span>
							{state.resumePicker.showPaths ? (
								<span className="session-meta">{session.sessionFilePath}</span>
							) : null}
						</button>
						{renameSessionId === session.sessionId ? (
							<form
								className="rename-form"
								onSubmit={(event) => {
									event.preventDefault();
									const nextTitle = renameTitle.trim();
									if (!nextTitle) return;
									setRenameSessionId(undefined);
									void store.renameResumeSession(session.workspaceId, session.sessionId, nextTitle);
								}}
							>
								<input
									aria-label="Session title"
									value={renameTitle}
									onChange={(event) => setRenameTitle(event.currentTarget.value)}
								/>
								<button type="submit" className="row-action" disabled={!renameTitle.trim()}>
									Save
								</button>
							</form>
						) : (
							<button
								type="button"
								className="row-action"
								onClick={() => {
									setRenameSessionId(session.sessionId);
									setRenameTitle(session.title);
								}}
							>
								Rename
							</button>
						)}
						<button
							type="button"
							className="row-action"
							onClick={() => {
								if (session.archivedAt) {
									void store.resumeUnarchiveSession(session.workspaceId, session.sessionId);
									return;
								}
								void store.resumeArchiveSession(session.workspaceId, session.sessionId);
							}}
						>
							{session.archivedAt ? "Restore" : "Archive"}
						</button>
					</div>
				))}
			</div>
		</ModalDialog>
	);
}

function SelectControl({
	label,
	onChange,
	value,
	values,
}: {
	label: string;
	onChange(value: string): void;
	value: string;
	values: readonly string[];
}) {
	return (
		<label className="select-control">
			<span>{label}</span>
			<select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
				{values.map((entry) => (
					<option key={entry} value={entry}>
						{entry}
					</option>
				))}
			</select>
		</label>
	);
}

function filterCommands(commands: readonly SlashCommandSnapshot[], query: string): SlashCommandSnapshot[] {
	if (!query) return [...commands];
	return commands.filter((command) => {
		const haystack = `${command.name} ${command.description ?? ""} ${command.source}`.toLowerCase();
		return haystack.includes(query);
	});
}

function normalizeQuery(query: string): string {
	return query.trim().replace(/^\//, "").toLowerCase();
}

function clampIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	return Math.max(0, Math.min(index, length - 1));
}
