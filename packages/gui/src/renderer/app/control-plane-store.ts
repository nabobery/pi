import {
	type CommonSettingsPatch,
	type GuiCommand,
	type GuiEvent,
	ResourcesGetInventory,
	ResourcesOpenSource,
	ResourcesReload,
	ResourcesRevealSource,
	SettingsGetEditorSnapshot,
	SettingsGetSummary,
	SettingsUpdateCommon,
	type RequestId,
	TrustGetStatus,
	TrustSaveDecision,
} from "../../contracts/index.ts";
import { applyCommandResultData } from "./app-result-appliers.ts";
import type { CatalogViewState, GuiCatalogStore, RendererCatalogApi } from "./app-store.ts";

export interface ControlPlaneState {
	open: boolean;
	tab: "trust" | "settings" | "resources";
	loading: boolean;
	error: string | undefined;
}

export interface ControlPlaneStoreActionsContext {
	api: RendererCatalogApi;
	getState(): CatalogViewState;
	nextRequestId(prefix: string): RequestId;
	updateState(update: (current: CatalogViewState) => CatalogViewState): void;
}

export function createControlPlaneStoreActions(
	context: ControlPlaneStoreActionsContext,
): Pick<
	GuiCatalogStore,
	| "closeControlPlane"
	| "getResourceInventory"
	| "getSettingsEditor"
	| "openControlPlane"
	| "openResourceSource"
	| "reloadResources"
	| "revealResourceSource"
	| "saveTrustDecision"
	| "updateCommonSettings"
> {
	async function invokeControlPlane(command: GuiCommand): Promise<void> {
		context.updateState((current) => ({
			...current,
			controlPlane: { ...current.controlPlane, loading: true, error: undefined },
		}));
		const result = await context.api.invoke(command);
		if (!result.ok) {
			context.updateState((current) => ({
				...current,
				controlPlane: { ...current.controlPlane, loading: false, error: result.error.message },
			}));
			return;
		}
		const nextState = await applyCommandResultData(context.getState(), result.data);
		context.updateState((current) => ({
			...nextState,
			controlPlane: { ...current.controlPlane, loading: false, error: undefined },
		}));
	}

	return {
		closeControlPlane: () => {
			context.updateState((current) => ({
				...current,
				controlPlane: { ...current.controlPlane, open: false, error: undefined },
			}));
		},
		getResourceInventory: (workspaceId, sessionId) =>
			invokeControlPlane(
				new ResourcesGetInventory({
					requestId: context.nextRequestId("resources.getInventory"),
					workspaceId,
					...(sessionId ? { sessionId } : {}),
				}),
			),
		getSettingsEditor: (workspaceId) =>
			invokeControlPlane(
				new SettingsGetEditorSnapshot({
					requestId: context.nextRequestId("settings.getEditorSnapshot"),
					workspaceId,
				}),
			),
		openControlPlane: async (tab, workspaceId, sessionId) => {
			context.updateState((current) => ({
				...current,
				controlPlane: { open: true, tab, loading: true, error: undefined },
			}));
			const results = await Promise.all([
				context.api.invoke(
					new SettingsGetSummary({ requestId: context.nextRequestId("settings.getSummary"), workspaceId }),
				),
				context.api.invoke(
					new SettingsGetEditorSnapshot({
						requestId: context.nextRequestId("settings.getEditorSnapshot"),
						workspaceId,
					}),
				),
				context.api.invoke(
					new TrustGetStatus({ requestId: context.nextRequestId("trust.getStatus"), workspaceId }),
				),
				context.api.invoke(
					new ResourcesGetInventory({
						requestId: context.nextRequestId("resources.getInventory"),
						workspaceId,
						...(sessionId ? { sessionId } : {}),
					}),
				),
			]);
			const failed = results.find((result) => !result.ok);
			if (failed && !failed.ok) {
				context.updateState((current) => ({
					...current,
					controlPlane: { ...current.controlPlane, open: true, tab, loading: false, error: failed.error.message },
				}));
				return;
			}
			const nextState = await results.reduce<Promise<CatalogViewState>>(
				async (currentState, result) =>
					result.ok ? applyCommandResultData(await currentState, result.data) : currentState,
				Promise.resolve(context.getState()),
			);
			context.updateState((current) => ({
				...nextState,
				controlPlane: { ...current.controlPlane, open: true, tab, loading: false, error: undefined },
			}));
		},
		openResourceSource: (workspaceId, resourceId) =>
			invokeControlPlane(
				new ResourcesOpenSource({
					requestId: context.nextRequestId("resources.openSource"),
					workspaceId,
					resourceId,
				}),
			),
		reloadResources: (workspaceId, sessionId) =>
			invokeControlPlane(
				new ResourcesReload({
					requestId: context.nextRequestId("resources.reload"),
					workspaceId,
					...(sessionId ? { sessionId } : {}),
				}),
			),
		revealResourceSource: (workspaceId, resourceId) =>
			invokeControlPlane(
				new ResourcesRevealSource({
					requestId: context.nextRequestId("resources.revealSource"),
					workspaceId,
					resourceId,
				}),
			),
		saveTrustDecision: (workspaceId, optionId) =>
			invokeControlPlane(
				new TrustSaveDecision({
					requestId: context.nextRequestId("trust.saveDecision"),
					workspaceId,
					optionId,
				}),
			),
		updateCommonSettings: (workspaceId, patch: CommonSettingsPatch) =>
			invokeControlPlane(
				new SettingsUpdateCommon({
					requestId: context.nextRequestId("settings.updateCommon"),
					workspaceId,
					scope: "global",
					patch,
				}),
			),
	};
}

export function emptyControlPlaneState(): ControlPlaneState {
	return {
		open: false,
		tab: "settings",
		loading: false,
		error: undefined,
	};
}

export function applyControlPlaneEvent(state: CatalogViewState, event: GuiEvent): CatalogViewState | undefined {
	if (event._tag === "settings.editorUpdated") {
		return {
			...state,
			settingsEditorByWorkspaceId: {
				...state.settingsEditorByWorkspaceId,
				[event.editor.workspaceId]: event.editor,
			},
		};
	}
	if (event._tag === "resources.inventoryUpdated") {
		return {
			...state,
			resourceInventoryByWorkspaceId: {
				...state.resourceInventoryByWorkspaceId,
				[event.inventory.workspaceId]: event.inventory,
			},
		};
	}
	return undefined;
}
