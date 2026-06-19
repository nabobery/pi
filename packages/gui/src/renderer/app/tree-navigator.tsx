import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
	SessionId,
	SessionTreeEntrySnapshot,
	TreeFilterMode,
	TreeNavigationSummaryMode,
	WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogViewState, GuiCatalogStore } from "./app-store.ts";
import { ModalDialog } from "./modal-dialog.tsx";

export function TreeNavigator({
	draft,
	selectedSessionId,
	selectedWorkspaceId,
	state,
	store,
}: {
	draft: string;
	selectedSessionId: SessionId | undefined;
	selectedWorkspaceId: WorkspaceId | undefined;
	state: CatalogViewState;
	store: GuiCatalogStore;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [summaryMode, setSummaryMode] = useState<TreeNavigationSummaryMode>("none");
	const [customInstructions, setCustomInstructions] = useState("");
	const [labelDraft, setLabelDraft] = useState("");
	const activeWorkspaceId = state.treeNavigator.workspaceId ?? selectedWorkspaceId;
	const activeSessionId = state.treeNavigator.sessionId ?? selectedSessionId;
	const activeKey = activeWorkspaceId && activeSessionId ? `${activeWorkspaceId}:${activeSessionId}` : undefined;
	const tree = activeKey ? state.treesBySessionKey[activeKey] : undefined;
	const visibleEntries = useMemo(() => {
		if (!tree) return [];
		return visibleTreeEntries(tree.entries, state.treeNavigator);
	}, [state.treeNavigator, tree]);
	const selectedEntryId =
		state.treeNavigator.selectedEntryId ?? tree?.leafEntryId ?? visibleEntries[0]?.entryId ?? undefined;
	const selectedIndex = Math.max(
		0,
		visibleEntries.findIndex((entry) => entry.entryId === selectedEntryId),
	);
	const selectedEntry = visibleEntries[selectedIndex];

	useEffect(() => {
		if (!state.treeNavigator.open) return;
		inputRef.current?.focus();
	}, [state.treeNavigator.open]);

	if (!state.treeNavigator.open || !activeWorkspaceId || !activeSessionId) return null;
	const workspaceId = activeWorkspaceId;
	const sessionId = activeSessionId;

	function close(): void {
		store.closeTreeNavigator();
	}

	function move(delta: number): void {
		const entry = visibleEntries[clampIndex(selectedIndex + delta, visibleEntries.length)];
		store.setTreeNavigatorSelectedEntry(entry?.entryId);
	}

	function navigateSelected(): void {
		if (!selectedEntry) return;
		if (draft.trim() && !globalThis.confirm("Replace or clear the current composer draft?")) return;
		void store.navigateTree({
			workspaceId,
			sessionId,
			targetEntryId: selectedEntry.entryId,
			summaryMode,
			...(summaryMode === "custom" && customInstructions.trim() ? { customInstructions } : {}),
		});
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			move(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			move(-1);
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			store.setTreeNavigatorSelectedEntry(visibleEntries[0]?.entryId);
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			store.setTreeNavigatorSelectedEntry(visibleEntries.at(-1)?.entryId);
			return;
		}
		if (event.key === "ArrowLeft" && selectedEntry?.hasChildren) {
			event.preventDefault();
			if (!state.treeNavigator.foldedEntryIds.includes(selectedEntry.entryId)) {
				store.collapseTreeNavigatorEntry(selectedEntry.entryId);
				return;
			}
			store.setTreeNavigatorSelectedEntry(selectedEntry.parentId ?? selectedEntry.entryId);
			return;
		}
		if (event.key === "ArrowLeft" && selectedEntry?.parentId) {
			event.preventDefault();
			store.setTreeNavigatorSelectedEntry(selectedEntry.parentId);
			return;
		}
		if (event.key === "ArrowRight" && selectedEntry?.hasChildren) {
			event.preventDefault();
			if (state.treeNavigator.foldedEntryIds.includes(selectedEntry.entryId)) {
				store.expandTreeNavigatorEntry(selectedEntry.entryId);
				return;
			}
			const firstChild = visibleEntries.find((entry) => entry.parentId === selectedEntry.entryId);
			store.setTreeNavigatorSelectedEntry(firstChild?.entryId ?? selectedEntry.entryId);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			navigateSelected();
		}
	}

	return (
		<ModalDialog
			className="command-modal tree-modal"
			initialFocusRef={inputRef}
			labelledBy="tree-navigator-title"
			onClose={close}
		>
			<div className="modal-title-row">
				<div>
					<p className="eyebrow">Tree</p>
					<h3 id="tree-navigator-title">Session tree</h3>
				</div>
				<button type="button" onClick={close}>
					Close
				</button>
			</div>
			<input
				ref={inputRef}
				aria-controls="tree-navigator-list"
				aria-label="Search session tree"
				autoComplete="off"
				placeholder="Search tree"
				value={state.treeNavigator.query}
				onChange={(event) => store.setTreeNavigatorQuery(event.currentTarget.value)}
				onKeyDown={handleKeyDown}
			/>
			<div className="picker-controls">
				<TreeFilterSelect value={state.treeNavigator.filterMode} onChange={store.setTreeNavigatorFilterMode} />
				<TreeSummarySelect value={summaryMode} onChange={setSummaryMode} />
				{summaryMode === "custom" ? (
					<input
						aria-label="Branch summary instructions"
						placeholder="Summary focus"
						value={customInstructions}
						onChange={(event) => setCustomInstructions(event.currentTarget.value)}
					/>
				) : null}
			</div>
			{state.treeNavigator.error ? <p className="inline-error">{state.treeNavigator.error}</p> : null}
			<div id="tree-navigator-list" className="command-list command-list--tall tree-list" role="tree">
				{state.treeNavigator.loading ? <p className="empty-copy">Loading tree.</p> : null}
				{!state.treeNavigator.loading && visibleEntries.length === 0 ? (
					<p className="empty-copy">No tree entries found.</p>
				) : null}
				{visibleEntries.map((entry, index) => (
					<button
						key={entry.entryId}
						type="button"
						aria-expanded={
							entry.hasChildren ? !state.treeNavigator.foldedEntryIds.includes(entry.entryId) : undefined
						}
						aria-level={entry.depth + 1}
						aria-selected={index === selectedIndex}
						className={treeRowClass(entry, index === selectedIndex)}
						role="treeitem"
						style={{ paddingLeft: `${10 + entry.depth * 18}px` }}
						onClick={() => store.setTreeNavigatorSelectedEntry(entry.entryId)}
						onDoubleClick={navigateSelected}
					>
						<span className="tree-row__kind">{entry.kind}</span>
						<span className="tree-row__text">{entry.textPreview || "(empty)"}</span>
						{entry.label ? <span className="tree-row__label">{entry.label}</span> : null}
					</button>
				))}
			</div>
			<div className="tree-actions">
				<input
					aria-label="Tree entry label"
					placeholder="Label selected entry"
					value={labelDraft}
					onChange={(event) => setLabelDraft(event.currentTarget.value)}
				/>
				<button
					type="button"
					disabled={!selectedEntry}
					onClick={() => {
						if (!selectedEntry) return;
						void store.setTreeEntryLabel(workspaceId, sessionId, selectedEntry.entryId, labelDraft);
					}}
				>
					Label
				</button>
				<button type="button" disabled={!selectedEntry} onClick={navigateSelected}>
					Go
				</button>
			</div>
		</ModalDialog>
	);
}

export function CompactDialog({ state, store }: { state: CatalogViewState; store: GuiCatalogStore }) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const dialog = state.compactDialog;

	useEffect(() => {
		if (!dialog.open) return;
		textareaRef.current?.focus();
	}, [dialog.open]);

	if (!dialog.open || !dialog.workspaceId || !dialog.sessionId) return null;
	const workspaceId = dialog.workspaceId;
	const sessionId = dialog.sessionId;
	function cancelOrClose(): void {
		if (dialog.compacting) {
			void store.cancelCompaction(workspaceId, sessionId);
			return;
		}
		store.closeCompactDialog();
	}

	return (
		<ModalDialog
			className="command-modal compact-modal"
			initialFocusRef={textareaRef}
			labelledBy="compact-dialog-title"
			onClose={cancelOrClose}
		>
			<div className="modal-title-row">
				<div>
					<p className="eyebrow">Compact</p>
					<h3 id="compact-dialog-title">Compact session</h3>
				</div>
				<button type="button" disabled={dialog.compacting} onClick={() => store.closeCompactDialog()}>
					Close
				</button>
			</div>
			<textarea
				ref={textareaRef}
				aria-label="Compaction instructions"
				placeholder="Optional focus instructions"
				value={dialog.customInstructions}
				onChange={(event) => store.setCompactInstructions(event.currentTarget.value)}
			/>
			{dialog.error ? <p className="inline-error">{dialog.error}</p> : null}
			<div className="composer-actions">
				<button type="button" disabled={dialog.cancelling} onClick={cancelOrClose}>
					{dialog.cancelling ? "Cancelling" : "Cancel"}
				</button>
				<button
					type="button"
					disabled={dialog.compacting}
					onClick={() => void store.compactSession(workspaceId, sessionId, dialog.customInstructions)}
				>
					{dialog.compacting ? "Compacting" : "Compact"}
				</button>
			</div>
		</ModalDialog>
	);
}

function TreeFilterSelect({ onChange, value }: { onChange(value: TreeFilterMode): void; value: TreeFilterMode }) {
	return (
		<label className="select-control">
			<span>Filter</span>
			<select value={value} onChange={(event) => onChange(event.currentTarget.value as TreeFilterMode)}>
				{["default", "no-tools", "user-only", "labeled-only", "all"].map((entry) => (
					<option key={entry} value={entry}>
						{entry}
					</option>
				))}
			</select>
		</label>
	);
}

function TreeSummarySelect({
	onChange,
	value,
}: {
	onChange(value: TreeNavigationSummaryMode): void;
	value: TreeNavigationSummaryMode;
}) {
	return (
		<label className="select-control">
			<span>Summary</span>
			<select value={value} onChange={(event) => onChange(event.currentTarget.value as TreeNavigationSummaryMode)}>
				<option value="none">none</option>
				<option value="default">default</option>
				<option value="custom">custom</option>
			</select>
		</label>
	);
}

function visibleTreeEntries(
	entries: readonly SessionTreeEntrySnapshot[],
	navigator: CatalogViewState["treeNavigator"],
): SessionTreeEntrySnapshot[] {
	const folded = new Set(navigator.foldedEntryIds);
	const hiddenByFold = new Set<string>();
	return entries.filter((entry) => {
		if (entry.parentId && hiddenByFold.has(entry.parentId)) {
			hiddenByFold.add(entry.entryId);
			return false;
		}
		if (folded.has(entry.entryId)) hiddenByFold.add(entry.entryId);
		return matchesFilter(entry, navigator.filterMode) && matchesQuery(entry, navigator.query);
	});
}

function matchesFilter(entry: SessionTreeEntrySnapshot, mode: TreeFilterMode): boolean {
	if (mode === "all") return true;
	if (mode === "no-tools") return entry.kind !== "tool";
	if (mode === "user-only") return entry.kind === "user";
	if (mode === "labeled-only") return Boolean(entry.label);
	if (entry.kind === "tool") return false;
	return entry.kind !== "unknown";
}

function matchesQuery(entry: SessionTreeEntrySnapshot, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return true;
	return entry.searchText.toLowerCase().includes(normalized);
}

function treeRowClass(entry: SessionTreeEntrySnapshot, selected: boolean): string {
	const classes = ["tree-row"];
	if (selected) classes.push("tree-row--selected");
	if (entry.isActivePath) classes.push("tree-row--path");
	if (entry.isActiveLeaf) classes.push("tree-row--leaf");
	return classes.join(" ");
}

function clampIndex(index: number, length: number): number {
	if (length <= 0) return 0;
	return Math.max(0, Math.min(index, length - 1));
}
