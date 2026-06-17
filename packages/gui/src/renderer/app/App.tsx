import { useEffect, useState } from "react";
import type { AppInfo } from "../../shared/contracts.ts";

type LoadState = { status: "loading" } | { status: "ready"; appInfo: AppInfo } | { status: "failed"; message: string };

export function App() {
	const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		let isMounted = true;

		window.piGui.getAppInfo().then(
			(appInfo) => {
				if (isMounted) {
					setLoadState({ status: "ready", appInfo });
				}
			},
			(error: unknown) => {
				if (isMounted) {
					setLoadState({ status: "failed", message: getErrorMessage(error) });
				}
			},
		);

		return () => {
			isMounted = false;
		};
	}, []);

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

	return (
		<main className="app-shell">
			<aside className="sidebar" aria-label="Workspace and sessions">
				<div>
					<p className="eyebrow">Pi</p>
					<h1>Pi</h1>
				</div>
				<div className="sidebar-section">
					<p className="section-label">Workspace</p>
					<p className="empty-copy">No workspace open.</p>
				</div>
				<div className="sidebar-section">
					<p className="section-label">Sessions</p>
					<p className="empty-copy">Sessions will appear here.</p>
				</div>
			</aside>
			<section className="main-region" aria-label="Session timeline">
				<header className="timeline-header">
					<div>
						<p className="eyebrow">Desktop shell</p>
						<h2>Ready</h2>
					</div>
					<p className="app-version">
						{loadState.appInfo.name} {loadState.appInfo.version}
					</p>
				</header>
				<div className="timeline">
					<p className="empty-title">No active session</p>
					<p className="empty-copy">Phase 1 only proves the shell, preload bridge, and secure renderer.</p>
				</div>
				<footer className="composer" aria-label="Composer">
					<textarea data-testid="composer-input" placeholder="Pi runtime arrives in Phase 2." disabled />
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

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "Unknown startup failure";
}
