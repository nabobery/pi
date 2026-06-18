import { useEffect, useMemo, useState, type FormEvent } from "react";
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
	const selectedKey =
		selectedWorkspace && selectedSession ? `${selectedWorkspace.id}:${selectedSession.id}` : undefined;
	const draft = selectedKey ? (state.composerDrafts[selectedKey] ?? "") : "";
	const canEditComposer =
		selectedSession?.status === "ready" ||
		selectedSession?.status === "running" ||
		selectedSession?.status === "cancelling";
	const canSend = Boolean(selectedWorkspace && selectedSession && canEditComposer && draft.trim());
	const isRunning = selectedSession?.status === "running";
	const isCancelling = selectedSession?.status === "cancelling";

	useEffect(() => {
		if (!selectedWorkspace || !selectedSession) return;
		if (selectedSession.status !== "ready") return;
		if (selectedTimeline) return;
		void store.getTranscript(selectedWorkspace.id, selectedSession.id);
	}, [selectedSession, selectedTimeline, selectedWorkspace, store]);

	function updateDraft(value: string): void {
		if (!selectedWorkspace || !selectedSession) return;
		store.setComposerDraft(selectedWorkspace.id, selectedSession.id, value);
	}

	async function sendDraft(deliveryMode?: "steer" | "followUp"): Promise<void> {
		if (!selectedWorkspace || !selectedSession) return;
		const message = draft.trim();
		if (!message) return;
		const accepted = await store.sendMessage(selectedWorkspace.id, selectedSession.id, message, deliveryMode);
		if (accepted) store.setComposerDraft(selectedWorkspace.id, selectedSession.id, "");
	}

	function submitPrompt(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		if (isRunning) return;
		void sendDraft();
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
				<form className="composer" aria-label="Composer" onSubmit={submitPrompt}>
					<textarea
						data-testid="composer-input"
						placeholder={selectedSession ? "Prompt Pi." : "Open a session."}
						disabled={!canEditComposer}
						value={draft}
						onChange={(event) => updateDraft(event.currentTarget.value)}
					/>
					<div className="composer-status">
						<span>Mode: {loadState.appInfo.mode}</span>
						<div className="composer-actions">
							{isRunning || isCancelling ? (
								<>
									<button
										type="button"
										disabled={!canSend || isCancelling}
										onClick={() => void sendDraft("steer")}
									>
										Steer
									</button>
									<button
										type="button"
										disabled={!canSend || isCancelling}
										onClick={() => void sendDraft("followUp")}
									>
										Follow-up
									</button>
									<button
										type="button"
										disabled={!selectedWorkspace || !selectedSession || isCancelling}
										onClick={() => {
											if (!selectedWorkspace || !selectedSession) return;
											void store.cancelRun(selectedWorkspace.id, selectedSession.id);
										}}
									>
										Cancel
									</button>
								</>
							) : (
								<button type="submit" disabled={!canSend}>
									Send
								</button>
							)}
						</div>
					</div>
				</form>
			</section>
		</main>
	);
}
