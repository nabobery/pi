import { useEffect, useMemo, useState } from "react";
import {
	createGuiCatalogStore,
	createValidatedRendererCatalogApi,
	useCatalogStore,
	type RendererCatalogApi,
} from "./app-store.ts";
import { loadBootstrapState, type LoadState } from "./bootstrap-loader.ts";
import { MainPane, SessionSection, WorkspaceSection } from "./catalog-view.tsx";

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

function ReadyApp({ api, loadState }: { api: RendererCatalogApi; loadState: Extract<LoadState, { status: "ready" }> }) {
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

	useEffect(() => {
		if (!selectedWorkspace || !selectedSession) return;
		if (selectedSession.status !== "ready") return;
		if (selectedTimeline) return;
		void store.getTranscript(selectedWorkspace.id, selectedSession.id);
	}, [selectedSession, selectedTimeline, selectedWorkspace, store]);

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
					store={store}
					pending={state.pending}
					selectedWorkspace={selectedWorkspace}
					sessionCatalog={sessionCatalog}
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
				<MainPane session={selectedSession} timeline={selectedTimeline} />
				<footer className="composer" aria-label="Composer">
					<textarea data-testid="composer-input" placeholder="No transcript loaded." disabled />
					<div className="composer-status">
						<span>Mode: {loadState.appInfo.mode}</span>
						<button type="button" disabled>
							Send
						</button>
					</div>
				</footer>
			</section>
		</main>
	);
}
