import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
	createGuiCatalogStore,
	createValidatedRendererCatalogApi,
	useCatalogStore,
	type RendererCatalogApi,
} from "./app-store.ts";
import { loadBootstrapState, type LoadState } from "./bootstrap-loader.ts";
import { MainPane, SessionSection, WorkspaceSection } from "./catalog-view.tsx";
import type { ExtensionUiRequestSnapshot, SessionId, WorkspaceId } from "../../contracts/index.ts";

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
	const modelThinking = selectedKey ? state.modelThinkingBySessionKey[selectedKey] : undefined;
	const extensionUi = selectedKey ? state.extensionUiBySessionKey[selectedKey] : undefined;
	const settingsSummary = selectedWorkspace ? state.settingsSummaryByWorkspaceId[selectedWorkspace.id] : undefined;
	const trustStatus = selectedWorkspace ? state.trustStatusByWorkspaceId[selectedWorkspace.id] : undefined;
	const canEditComposer =
		selectedSession?.status === "ready" ||
		selectedSession?.status === "running" ||
		selectedSession?.status === "cancelling";
	const canSend = Boolean(selectedWorkspace && selectedSession && canEditComposer && draft.trim());
	const isRunning = selectedSession?.status === "running";
	const isCancelling = selectedSession?.status === "cancelling";
	const selectedModelOptionIndex = modelThinking
		? modelThinking.models.findIndex(
				(model) => model.provider === modelThinking.provider && model.modelId === modelThinking.modelId,
			)
		: -1;

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
					<div className="runtime-controls" aria-label="Runtime controls">
						<label>
							<span>Model</span>
							<select
								disabled={!modelThinking}
								value={selectedModelOptionIndex >= 0 ? String(selectedModelOptionIndex) : ""}
								onChange={(event) => {
									if (!modelThinking) return;
									const model = modelThinking.models[Number(event.currentTarget.value)];
									if (!model) return;
									void store.setModel(selectedWorkspace.id, selectedSession.id, model.provider, model.modelId);
								}}
							>
								{modelThinking ? (
									modelThinking.models.map((model, index) => (
										<option
											key={`${model.provider}/${model.modelId}`}
											value={String(index)}
											disabled={!model.authAvailable}
										>
											{model.provider}/{model.name}
											{model.authAvailable ? "" : " (auth missing)"}
										</option>
									))
								) : (
									<option value="">Runtime unavailable</option>
								)}
							</select>
						</label>
						<label>
							<span>Thinking</span>
							<select
								disabled={!modelThinking}
								value={modelThinking?.thinkingLevel ?? "off"}
								onChange={(event) => {
									if (!modelThinking) return;
									void store.setThinkingLevel(
										selectedWorkspace.id,
										selectedSession.id,
										event.currentTarget.value as typeof modelThinking.thinkingLevel,
									);
								}}
							>
								{(modelThinking?.availableThinkingLevels ?? ["off"]).map((level) => (
									<option key={level} value={level}>
										{level}
									</option>
								))}
							</select>
						</label>
					</div>
				) : null}
				<MainPane session={selectedSession} timeline={selectedTimeline} />
				{extensionUi ? <ExtensionUiInlineState extensionUi={extensionUi} /> : null}
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

function SettingsTrustPanel({
	store,
	selectedWorkspaceId,
	settingsSummary,
	trustStatus,
}: {
	store: ReturnType<typeof createGuiCatalogStore>;
	selectedWorkspaceId: WorkspaceId | undefined;
	settingsSummary: ReturnType<typeof useCatalogStore>["settingsSummaryByWorkspaceId"][string] | undefined;
	trustStatus: ReturnType<typeof useCatalogStore>["trustStatusByWorkspaceId"][string] | undefined;
}) {
	if (!selectedWorkspaceId) return null;
	return (
		<div className="sidebar-section">
			<p className="section-label">Settings</p>
			<dl className="summary-list">
				<div>
					<dt>Model</dt>
					<dd>{settingsSummary?.defaultModel ?? "unset"}</dd>
				</div>
				<div>
					<dt>Provider</dt>
					<dd>{settingsSummary?.defaultProvider ?? "unset"}</dd>
				</div>
				<div>
					<dt>Skills</dt>
					<dd>{settingsSummary?.enableSkillCommands === false ? "disabled" : "enabled"}</dd>
				</div>
				<div>
					<dt>Trust</dt>
					<dd>{trustStatus?.trusted ? "trusted" : "not trusted"}</dd>
				</div>
			</dl>
			<div className="button-group button-group--wrap">
				<button type="button" onClick={() => void store.openSettingsFile(selectedWorkspaceId, "global")}>
					Open global
				</button>
				<button type="button" onClick={() => void store.revealSettingsFile(selectedWorkspaceId, "global")}>
					Reveal global
				</button>
				<button type="button" onClick={() => void store.openSettingsFile(selectedWorkspaceId, "project")}>
					Open project
				</button>
				<button type="button" onClick={() => void store.revealSettingsFile(selectedWorkspaceId, "project")}>
					Reveal project
				</button>
			</div>
		</div>
	);
}

function ExtensionUiInlineState({
	extensionUi,
}: {
	extensionUi: NonNullable<ReturnType<typeof useCatalogStore>["extensionUiBySessionKey"][string]>;
}) {
	const statuses = Object.entries(extensionUi.statuses);
	return (
		<div className="extension-strip">
			{extensionUi.title ? <p>{extensionUi.title}</p> : null}
			{statuses.map(([key, value]) => (
				<p key={key}>
					{key}: {value}
				</p>
			))}
			{extensionUi.notifications.map((notification) => (
				<p key={`${notification.kind}:${notification.notifyType ?? "info"}:${notification.message ?? ""}`}>
					{notification.message}
				</p>
			))}
			{extensionUi.compatibilityIssues.map((message) => (
				<p key={message} className="inline-error">
					{message}
				</p>
			))}
		</div>
	);
}

function ExtensionUiLayer({
	draft,
	request,
	sessionId,
	store,
	workspaceId,
}: {
	draft: string;
	request: ExtensionUiRequestSnapshot | undefined;
	sessionId: SessionId;
	store: ReturnType<typeof createGuiCatalogStore>;
	workspaceId: WorkspaceId;
}) {
	const [value, setValue] = useState(request?.prefill ?? "");
	const respondedEditorTextRequestId = useRef<string | undefined>(undefined);

	useEffect(() => {
		setValue(request?.prefill ?? "");
		if (request?.kind === "getEditorText" && respondedEditorTextRequestId.current !== request.id) {
			respondedEditorTextRequestId.current = request.id;
			void store.respondToExtensionUi(workspaceId, sessionId, request, { kind: "getEditorText", value: draft });
		}
	}, [draft, request, sessionId, store, workspaceId]);

	useEffect(() => {
		if (!request || request.kind === "getEditorText") return;
		const activeRequest = request;
		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key !== "Escape") return;
			event.preventDefault();
			cancelRequest(activeRequest, store, workspaceId, sessionId);
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [request, sessionId, store, workspaceId]);

	if (!request || request.kind === "getEditorText") return null;

	function cancel(): void {
		const activeRequest = request;
		if (!activeRequest) return;
		cancelRequest(activeRequest, store, workspaceId, sessionId);
	}

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const activeRequest = request;
		if (!activeRequest) return;
		if (activeRequest.kind === "confirm") {
			void store.respondToExtensionUi(workspaceId, sessionId, activeRequest, { kind: "confirm", confirmed: true });
			return;
		}
		void store.respondToExtensionUi(workspaceId, sessionId, activeRequest, {
			kind: activeRequest.kind,
			value,
			cancelled: false,
		});
	}

	return (
		<div className="modal-backdrop" role="presentation">
			<form
				aria-labelledby="extension-ui-title"
				aria-modal="true"
				className="extension-modal"
				onSubmit={submit}
				role="dialog"
			>
				<p className="eyebrow">Extension</p>
				<h3 id="extension-ui-title">{request.title}</h3>
				{request.message ? <p className="muted">{request.message}</p> : null}
				{request.kind === "select" ? (
					<select value={value} onChange={(event) => setValue(event.currentTarget.value)}>
						<option value="">Select</option>
						{request.options?.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				) : null}
				{request.kind === "input" ? (
					<input
						autoFocus
						placeholder={request.placeholder}
						value={value}
						onChange={(event) => setValue(event.currentTarget.value)}
					/>
				) : null}
				{request.kind === "editor" ? (
					<textarea autoFocus value={value} onChange={(event) => setValue(event.currentTarget.value)} />
				) : null}
				<div className="composer-actions">
					<button type="button" onClick={cancel}>
						Cancel
					</button>
					<button type="submit">{request.kind === "confirm" ? "Confirm" : "Submit"}</button>
				</div>
			</form>
		</div>
	);
}

function cancelRequest(
	request: ExtensionUiRequestSnapshot,
	store: ReturnType<typeof createGuiCatalogStore>,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
): void {
	if (request.kind === "confirm") {
		void store.respondToExtensionUi(workspaceId, sessionId, request, { kind: "confirm", confirmed: false });
		return;
	}
	if (request.kind === "getEditorText") return;
	void store.respondToExtensionUi(workspaceId, sessionId, request, {
		kind: request.kind,
		cancelled: true,
	});
}
