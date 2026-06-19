import { useEffect, useMemo, useState } from "react";
import {
	createGuiCatalogStore,
	createValidatedRendererCatalogApi,
	useCatalogStore,
	type RendererCatalogApi,
} from "./app-store.ts";
import {
	Composer,
	ExtensionUiInlineState,
	ExtensionUiLayer,
	QueuePanel,
	RuntimeControls,
	SettingsTrustPanel,
} from "./app-panels.tsx";
import { loadBootstrapState, type LoadState } from "./bootstrap-loader.ts";
import { MainPane, SessionSection, WorkspaceSection } from "./catalog-view.tsx";
import { CommandPalette, ResumePicker } from "./command-palette.tsx";
import { CompactDialog, TreeNavigator } from "./tree-navigator.tsx";

export function App() {
	const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
	const api = useMemo(() => createValidatedRendererCatalogApi(window.piGui), []);

	useEffect(() => {
		let isMounted = true;

		void loadBootstrapState(api).then((nextLoadState) => {
			if (isMounted) setLoadState(nextLoadState);
		});

		return () => {
			isMounted = false;
		};
	}, [api]);

	if (loadState.status === "loading") {
		return (
			<main className="app-shell app-shell--centered">
				<p className="eyebrow">Pi Desktop</p>
				<h1>Starting Pi</h1>
				<p className="muted">Preparing the desktop shell.</p>
			</main>
		);
	}

	if (loadState.status === "failed") {
		return (
			<main className="app-shell app-shell--centered">
				<p className="eyebrow">Pi Desktop</p>
				<h1>Pi could not start</h1>
				<p className="error-text">{loadState.message}</p>
			</main>
		);
	}

	return <ReadyApp api={api} loadState={loadState} />;
}

export function ReadyApp({
	api,
	loadState,
}: {
	api: RendererCatalogApi;
	loadState: Extract<LoadState, { status: "ready" }>;
}) {
	const store = useMemo(
		() => createGuiCatalogStore(api, loadState.workspaceCatalog, { initialError: loadState.warnings[0]?.message }),
		[api, loadState.workspaceCatalog, loadState.warnings],
	);
	const state = useCatalogStore(store);
	const selectedWorkspace = state.workspaceCatalog.workspaces.find((workspace) => workspace.selected);
	const sessionCatalog = selectedWorkspace ? state.sessionCatalogs[selectedWorkspace.id] : undefined;
	const selectedSession = sessionCatalog?.sessions.find((session) => session.id === sessionCatalog.selectedSessionId);
	const selectedTimeline =
		selectedWorkspace && selectedSession
			? state.timelines[`${selectedWorkspace.id}:${selectedSession.id}`]
			: undefined;
	const selectedKey =
		selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : undefined;
	const draft = selectedKey ? (state.composerDrafts[selectedKey] ?? "") : "";
	const modelThinking = selectedKey ? state.modelThinkingBySessionKey[selectedKey] : undefined;
	const selectedQueue = selectedKey ? state.queuesBySessionKey[selectedKey] : undefined;
	const extensionUi = selectedKey ? state.extensionUiBySessionKey[selectedKey] : undefined;
	const settingsSummary = selectedWorkspace ? state.settingsSummaryByWorkspaceId[selectedWorkspace.id] : undefined;
	const trustStatus = selectedWorkspace ? state.trustStatusByWorkspaceId[selectedWorkspace.id] : undefined;

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent): void {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
			event.preventDefault();
			store.openCommandPalette();
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [store]);

	useEffect(() => {
		if (!selectedWorkspace || !selectedSession) return;
		if (selectedSession.status !== "ready") return;
		if (selectedTimeline) return;
		void store.getTranscript(selectedWorkspace.id, selectedSession.id);
	}, [selectedSession, selectedTimeline, selectedWorkspace, store]);

	useEffect(() => {
		if (!selectedWorkspace) return;
		if (!settingsSummary) void store.getSettingsSummary(selectedWorkspace.id);
		if (!trustStatus) void store.getTrustStatus(selectedWorkspace.id);
	}, [selectedWorkspace, settingsSummary, store, trustStatus]);

	function updateDraft(value: string): void {
		if (!selectedWorkspace || !selectedSession) return;
		store.setComposerDraft(selectedWorkspace.id, selectedSession.id, value);
		if (value === "/" || (value.startsWith("/") && !state.commandPalette.open)) {
			store.openCommandPalette(value);
		}
	}

	async function sendDraft(deliveryMode?: "steer" | "followUp"): Promise<void> {
		if (!selectedWorkspace || !selectedSession) return;
		const message = draft.trim();
		if (!message) return;
		const accepted = await store.sendMessage(selectedWorkspace.id, selectedSession.id, message, deliveryMode);
		if (accepted) store.setComposerDraft(selectedWorkspace.id, selectedSession.id, "");
	}

	return (
		<main className="app-shell">
			<aside className="sidebar" aria-label="Workspace and sessions">
				<div>
					<p className="eyebrow">Pi</p>
					<h1>Pi</h1>
				</div>
				<WorkspaceSection
					store={store}
					workspaces={state.workspaceCatalog.workspaces}
					selectedWorkspace={selectedWorkspace}
				/>
				<SessionSection
					activityBySessionKey={state.activityBySessionKey}
					runtimeOverlaysBySessionKey={state.runtimeOverlaysBySessionKey}
					sessionRenameRequestsBySessionKey={state.sessionRenameRequestsBySessionKey}
					store={store}
					pending={state.pending}
					selectedWorkspace={selectedWorkspace}
					sessionCatalog={sessionCatalog}
				/>
				<SettingsTrustPanel
					store={store}
					selectedWorkspaceId={selectedWorkspace?.id}
					settingsSummary={settingsSummary}
					trustStatus={trustStatus}
				/>
				{state.error ? <p className="inline-error">{state.error}</p> : null}
			</aside>
			<section className="main-region" aria-label="Session timeline">
				<header className="timeline-header">
					<div>
						<p className="eyebrow">{selectedWorkspace?.name ?? "Desktop shell"}</p>
						<h2>{selectedSession?.title ?? "No active session"}</h2>
					</div>
					<p className="app-version">
						{loadState.appInfo.name} {loadState.appInfo.version}
					</p>
				</header>
				{selectedWorkspace && selectedSession ? (
					<RuntimeControls
						id="runtime-controls"
						modelThinking={modelThinking}
						onSetModel={(provider, modelId) =>
							void store.setModel(selectedWorkspace.id, selectedSession.id, provider, modelId)
						}
						onSetThinkingLevel={(level) =>
							void store.setThinkingLevel(selectedWorkspace.id, selectedSession.id, level)
						}
					/>
				) : null}
				<MainPane session={selectedSession} timeline={selectedTimeline} />
				{extensionUi ? <ExtensionUiInlineState extensionUi={extensionUi} /> : null}
				<QueuePanel
					queue={selectedQueue}
					onRestore={() => {
						if (!selectedWorkspace || !selectedSession) return;
						void store.restoreQueuedMessages(selectedWorkspace.id, selectedSession.id);
					}}
				/>
				<Composer
					appMode={loadState.appInfo.mode}
					draft={draft}
					onCancel={() => {
						if (!selectedWorkspace || !selectedSession) return;
						void store.cancelRun(selectedWorkspace.id, selectedSession.id);
					}}
					onDraftChange={updateDraft}
					onSend={(deliveryMode) => void sendDraft(deliveryMode)}
					selectedSession={selectedSession}
				/>
				<CommandPalette
					selectedSessionId={selectedSession?.id}
					selectedWorkspaceId={selectedWorkspace?.id}
					state={state}
					store={store}
				/>
				<ResumePicker selectedWorkspaceId={selectedWorkspace?.id} state={state} store={store} />
				<TreeNavigator
					draft={draft}
					selectedSessionId={selectedSession?.id}
					selectedWorkspaceId={selectedWorkspace?.id}
					state={state}
					store={store}
				/>
				<CompactDialog state={state} store={store} />
				{selectedWorkspace && selectedSession && extensionUi ? (
					<ExtensionUiLayer
						draft={draft}
						request={extensionUi.requests[0]}
						store={store}
						workspaceId={selectedWorkspace.id}
						sessionId={selectedSession.id}
					/>
				) : null}
			</section>
		</main>
	);
}
