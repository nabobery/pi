import {
	ResumeArchive,
	ResumeOpen,
	ResumeRename,
	ResumeSearch,
	ResumeUnarchive,
	type ResumeNameFilter,
	type ResumeScope,
	type ResumeSearchSnapshot,
	type ResumeSortMode,
	SessionGetSlashCommands,
	type SlashCommandCatalogSnapshot,
	decodeResumeSearchSnapshot,
	decodeSlashCommandCatalogSnapshot,
	type GuiCommand,
	type RequestId,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { sessionKey } from "./session-state-projections.ts";
import type { CatalogViewState, GuiCatalogStore, RendererCatalogApi } from "./app-store.ts";

export interface CommandPaletteState {
	open: boolean;
	query: string;
	selectedIndex: number;
	loading: boolean;
	error: string | undefined;
}

export interface ResumePickerState {
	open: boolean;
	query: string;
	scope: ResumeScope;
	sortMode: ResumeSortMode;
	nameFilter: ResumeNameFilter;
	includeArchived: boolean;
	showPaths: boolean;
	selectedIndex: number;
	loading: boolean;
	error: string | undefined;
	result: ResumeSearchSnapshot | undefined;
}

export type CommandPaletteStoreActions = Pick<
	GuiCatalogStore,
	| "closeCommandPalette"
	| "closeResumePicker"
	| "getSlashCommands"
	| "openCommandPalette"
	| "openResumePicker"
	| "renameResumeSession"
	| "requestSessionRename"
	| "resumeArchiveSession"
	| "resumeOpenSession"
	| "resumeUnarchiveSession"
	| "searchResume"
	| "setCommandPaletteQuery"
	| "setCommandPaletteSelectedIndex"
	| "setResumePickerSelectedIndex"
	| "setResumePickerShowPaths"
>;

export interface CommandPaletteStoreContext {
	api: RendererCatalogApi;
	getState(): CatalogViewState;
	invoke(command: GuiCommand): Promise<boolean>;
	nextRequestId(prefix: string): RequestId;
	updateState(update: (current: CatalogViewState) => CatalogViewState): void;
}

export function createCommandPaletteStoreActions(context: CommandPaletteStoreContext): CommandPaletteStoreActions {
	let slashCatalogSequence = 0;
	let resumeSearchSequence = 0;

	const searchResumeWithState = async (
		workspaceId: WorkspaceId,
		patch: Partial<Pick<ResumePickerState, "includeArchived" | "nameFilter" | "query" | "scope" | "sortMode">>,
	): Promise<void> => {
		const sequence = ++resumeSearchSequence;
		let requestPicker = context.getState().resumePicker;
		context.updateState((current) => {
			requestPicker = { ...current.resumePicker, ...patch, open: true, loading: true, error: undefined };
			return { ...current, resumePicker: requestPicker };
		});
		const result = await context.api.invoke(
			new ResumeSearch({
				requestId: context.nextRequestId("resume.search"),
				workspaceId,
				query: requestPicker.query,
				scope: requestPicker.scope,
				sortMode: requestPicker.sortMode,
				nameFilter: requestPicker.nameFilter,
				includeArchived: requestPicker.includeArchived,
			}),
		);
		if (sequence !== resumeSearchSequence) return;
		if (!result.ok) {
			context.updateState((current) => ({
				...current,
				resumePicker: { ...current.resumePicker, loading: false, error: result.error.message },
			}));
			return;
		}
		const search = await decodeResumeSearch(result.data);
		if (sequence !== resumeSearchSequence) return;
		context.updateState((current) => ({
			...current,
			resumePicker: {
				...current.resumePicker,
				query: requestPicker.query,
				scope: requestPicker.scope,
				sortMode: requestPicker.sortMode,
				nameFilter: requestPicker.nameFilter,
				includeArchived: requestPicker.includeArchived,
				loading: false,
				error: undefined,
				result: search,
				selectedIndex: Math.min(current.resumePicker.selectedIndex, Math.max(0, (search?.results.length ?? 1) - 1)),
			},
		}));
	};

	return {
		closeCommandPalette: () => {
			context.updateState((current) => ({
				...current,
				commandPalette: { ...current.commandPalette, open: false, error: undefined },
			}));
		},
		closeResumePicker: () => {
			context.updateState((current) => ({
				...current,
				resumePicker: { ...current.resumePicker, open: false, error: undefined },
			}));
		},
		getSlashCommands: async (workspaceId, sessionId) => {
			const sequence = ++slashCatalogSequence;
			const key = sessionKey(workspaceId, sessionId);
			context.updateState((current) => ({
				...current,
				commandPalette: { ...current.commandPalette, loading: true, error: undefined },
			}));
			const result = await context.api.invoke(
				new SessionGetSlashCommands({
					requestId: context.nextRequestId("session.getSlashCommands"),
					workspaceId,
					sessionId,
				}),
			);
			if (sequence !== slashCatalogSequence) return;
			if (!result.ok) {
				context.updateState((current) => ({
					...current,
					commandPalette: { ...current.commandPalette, loading: false, error: result.error.message },
				}));
				return;
			}
			const catalog = await decodeSlashCommandCatalog(result.data);
			if (sequence !== slashCatalogSequence) return;
			context.updateState((current) => ({
				...current,
				slashCommandCatalogsBySessionKey: catalog
					? { ...current.slashCommandCatalogsBySessionKey, [key]: catalog }
					: current.slashCommandCatalogsBySessionKey,
				commandPalette: { ...current.commandPalette, loading: false, error: undefined },
			}));
		},
		openCommandPalette: (query = "") => {
			context.updateState((current) => ({
				...current,
				commandPalette: { open: true, query, selectedIndex: 0, loading: false, error: undefined },
			}));
		},
		openResumePicker: async (workspaceId) => {
			context.updateState((current) => ({
				...current,
				resumePicker: { ...current.resumePicker, open: true, loading: true, error: undefined },
			}));
			await searchResumeWithState(workspaceId, {});
		},
		renameResumeSession: async (workspaceId, sessionId, title) => {
			const ok = await context.invoke(
				new ResumeRename({ requestId: context.nextRequestId("resume.rename"), workspaceId, sessionId, title }),
			);
			if (ok) await searchResumeWithState(workspaceId, {});
		},
		requestSessionRename: (workspaceId, sessionId) => {
			const key = sessionKey(workspaceId, sessionId);
			context.updateState((current) => ({
				...current,
				sessionRenameRequestsBySessionKey: {
					...current.sessionRenameRequestsBySessionKey,
					[key]: (current.sessionRenameRequestsBySessionKey[key] ?? 0) + 1,
				},
			}));
		},
		resumeArchiveSession: async (workspaceId, sessionId) => {
			const ok = await context.invoke(
				new ResumeArchive({ requestId: context.nextRequestId("resume.archive"), workspaceId, sessionId }),
			);
			if (ok) await searchResumeWithState(workspaceId, {});
		},
		resumeOpenSession: async (workspaceId, sessionId) => {
			const ok = await context.invoke(
				new ResumeOpen({ requestId: context.nextRequestId("resume.open"), workspaceId, sessionId }),
			);
			if (ok) {
				context.updateState((current) => ({
					...current,
					resumePicker: { ...current.resumePicker, open: false, error: undefined },
				}));
			}
		},
		resumeUnarchiveSession: async (workspaceId, sessionId) => {
			const ok = await context.invoke(
				new ResumeUnarchive({ requestId: context.nextRequestId("resume.unarchive"), workspaceId, sessionId }),
			);
			if (ok) await searchResumeWithState(workspaceId, {});
		},
		searchResume: (workspaceId, patch = {}) => searchResumeWithState(workspaceId, patch),
		setCommandPaletteQuery: (query) => {
			context.updateState((current) => ({
				...current,
				commandPalette: { ...current.commandPalette, query, selectedIndex: 0, error: undefined },
			}));
		},
		setCommandPaletteSelectedIndex: (selectedIndex) => {
			context.updateState((current) => ({
				...current,
				commandPalette: { ...current.commandPalette, selectedIndex },
			}));
		},
		setResumePickerSelectedIndex: (selectedIndex) => {
			context.updateState((current) => ({
				...current,
				resumePicker: { ...current.resumePicker, selectedIndex },
			}));
		},
		setResumePickerShowPaths: (showPaths) => {
			context.updateState((current) => ({
				...current,
				resumePicker: { ...current.resumePicker, showPaths },
			}));
		},
	};
}

export function emptyCommandPaletteState(): CommandPaletteState {
	return { open: false, query: "", selectedIndex: 0, loading: false, error: undefined };
}

export function emptyResumePickerState(): ResumePickerState {
	return {
		open: false,
		query: "",
		scope: "currentWorkspace",
		sortMode: "threaded",
		nameFilter: "all",
		includeArchived: false,
		showPaths: false,
		selectedIndex: 0,
		loading: false,
		error: undefined,
		result: undefined,
	};
}

async function decodeSlashCommandCatalog(data: unknown): Promise<SlashCommandCatalogSnapshot | undefined> {
	try {
		return await decodeSlashCommandCatalogSnapshot(data);
	} catch {
		return undefined;
	}
}

async function decodeResumeSearch(data: unknown): Promise<ResumeSearchSnapshot | undefined> {
	try {
		return await decodeResumeSearchSnapshot(data);
	} catch {
		return undefined;
	}
}
