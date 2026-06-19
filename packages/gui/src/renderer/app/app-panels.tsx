import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
	ExtensionUiRequestSnapshot,
	ModelThinkingSnapshot,
	SessionId,
	SessionSnapshot,
	WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogViewState, GuiCatalogStore } from "./app-store.ts";

type CatalogState = CatalogViewState;

export function RuntimeControls({
	modelThinking,
	onSetModel,
	onSetThinkingLevel,
}: {
	modelThinking: ModelThinkingSnapshot | undefined;
	onSetModel(provider: string, modelId: string): void;
	onSetThinkingLevel(level: ModelThinkingSnapshot["thinkingLevel"]): void;
}) {
	const selectedModelOptionIndex = modelThinking
		? modelThinking.models.findIndex(
				(model) => model.provider === modelThinking.provider && model.modelId === modelThinking.modelId,
			)
		: -1;

	return (
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
						onSetModel(model.provider, model.modelId);
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
						onSetThinkingLevel(event.currentTarget.value as ModelThinkingSnapshot["thinkingLevel"]);
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
	);
}

export function Composer({
	appMode,
	draft,
	onCancel,
	onDraftChange,
	onSend,
	selectedSession,
}: {
	appMode: string;
	draft: string;
	onCancel(): void;
	onDraftChange(value: string): void;
	onSend(deliveryMode?: "steer" | "followUp"): void;
	selectedSession: SessionSnapshot | undefined;
}) {
	const canEditComposer =
		selectedSession?.status === "ready" ||
		selectedSession?.status === "running" ||
		selectedSession?.status === "cancelling";
	const canSend = Boolean(selectedSession && canEditComposer && draft.trim());
	const isRunning = selectedSession?.status === "running";
	const isCancelling = selectedSession?.status === "cancelling";

	function submitPrompt(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		if (isRunning) return;
		onSend();
	}

	return (
		<form className="composer" aria-label="Composer" onSubmit={submitPrompt}>
			<textarea
				data-testid="composer-input"
				placeholder={selectedSession ? "Prompt Pi." : "Open a session."}
				disabled={!canEditComposer}
				value={draft}
				onChange={(event) => onDraftChange(event.currentTarget.value)}
			/>
			<div className="composer-status">
				<span>Mode: {appMode}</span>
				<div className="composer-actions">
					{isRunning || isCancelling ? (
						<>
							<button type="button" disabled={!canSend || isCancelling} onClick={() => onSend("steer")}>
								Steer
							</button>
							<button type="button" disabled={!canSend || isCancelling} onClick={() => onSend("followUp")}>
								Follow-up
							</button>
							<button type="button" disabled={!selectedSession || isCancelling} onClick={onCancel}>
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
	);
}

export function SettingsTrustPanel({
	selectedWorkspaceId,
	settingsSummary,
	store,
	trustStatus,
}: {
	selectedWorkspaceId: WorkspaceId | undefined;
	settingsSummary: CatalogState["settingsSummaryByWorkspaceId"][string] | undefined;
	store: GuiCatalogStore;
	trustStatus: CatalogState["trustStatusByWorkspaceId"][string] | undefined;
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

export function ExtensionUiInlineState({
	extensionUi,
}: {
	extensionUi: NonNullable<CatalogState["extensionUiBySessionKey"][string]>;
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

export function ExtensionUiLayer({
	draft,
	request,
	sessionId,
	store,
	workspaceId,
}: {
	draft: string;
	request: ExtensionUiRequestSnapshot | undefined;
	sessionId: SessionId;
	store: GuiCatalogStore;
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
	store: GuiCatalogStore,
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
