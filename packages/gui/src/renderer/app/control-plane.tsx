import { useEffect, useMemo, useRef, useState } from "react";
import type {
	CommonSettingsPatch,
	ResourceInventorySnapshot,
	SessionId,
	SettingsEditorSnapshot,
	SettingsFieldSnapshot,
	TrustStatusSnapshot,
	WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogViewState, GuiCatalogStore } from "./app-store.ts";
import { ModalDialog } from "./modal-dialog.tsx";

export function ControlPlaneDialog({
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
	const titleRef = useRef<HTMLHeadingElement>(null);
	const workspaceId = selectedWorkspaceId;
	const editor = workspaceId ? state.settingsEditorByWorkspaceId[workspaceId] : undefined;
	const trust = workspaceId ? state.trustStatusByWorkspaceId[workspaceId] : undefined;
	const inventory = workspaceId ? state.resourceInventoryByWorkspaceId[workspaceId] : undefined;

	if (!state.controlPlane.open || !workspaceId) return null;

	return (
		<ModalDialog
			className="command-modal control-plane-modal"
			initialFocusRef={titleRef}
			labelledBy="control-plane-title"
			onClose={store.closeControlPlane}
		>
			<div className="modal-title-row">
				<div>
					<p className="eyebrow">Pi</p>
					<h3 id="control-plane-title" ref={titleRef} tabIndex={-1}>
						Control Plane
					</h3>
				</div>
				<button type="button" onClick={store.closeControlPlane}>
					Close
				</button>
			</div>
			<div className="tab-row" role="tablist" aria-label="Control Plane sections">
				{(["trust", "settings", "resources"] as const).map((tab) => (
					<button
						key={tab}
						type="button"
						aria-selected={state.controlPlane.tab === tab}
						className={state.controlPlane.tab === tab ? "is-selected" : ""}
						onClick={() => void store.openControlPlane(tab, workspaceId, selectedSessionId)}
					>
						{tab}
					</button>
				))}
			</div>
			{state.controlPlane.error ? <p className="inline-error">{state.controlPlane.error}</p> : null}
			{state.controlPlane.loading ? <p className="inline-status">Loading.</p> : null}
			{state.controlPlane.tab === "trust" ? (
				<TrustTab trust={trust} workspaceId={workspaceId} store={store} />
			) : null}
			{state.controlPlane.tab === "settings" ? (
				<SettingsTab editor={editor} workspaceId={workspaceId} store={store} />
			) : null}
			{state.controlPlane.tab === "resources" ? (
				<ResourcesTab
					inventory={inventory}
					selectedSessionId={selectedSessionId}
					workspaceId={workspaceId}
					store={store}
				/>
			) : null}
		</ModalDialog>
	);
}

function TrustTab({
	store,
	trust,
	workspaceId,
}: {
	store: GuiCatalogStore;
	trust: TrustStatusSnapshot | undefined;
	workspaceId: WorkspaceId;
}) {
	if (!trust) return <p className="empty-copy">Trust status unavailable.</p>;
	return (
		<section className="control-section">
			<dl className="summary-list">
				<div>
					<dt>Status</dt>
					<dd>{trust.trusted ? "trusted" : "not trusted"}</dd>
				</div>
				<div>
					<dt>Source</dt>
					<dd>{trust.source}</dd>
				</div>
				<div>
					<dt>Requires trust</dt>
					<dd>{trust.requiresTrust ? "yes" : "no"}</dd>
				</div>
				{trust.savedPath ? (
					<div>
						<dt>Saved path</dt>
						<dd>{trust.savedPath}</dd>
					</div>
				) : null}
			</dl>
			<div className="resource-list">
				{trust.options.map((option) => (
					<div key={option.id} className="resource-row">
						<div>
							<strong>{option.label}</strong>
							<p>{option.trusted ? "Trust project resources" : "Block project resources"}</p>
						</div>
						<button type="button" onClick={() => void store.saveTrustDecision(workspaceId, option.id)}>
							Apply
						</button>
					</div>
				))}
			</div>
		</section>
	);
}

function SettingsTab({
	editor,
	store,
	workspaceId,
}: {
	editor: SettingsEditorSnapshot | undefined;
	store: GuiCatalogStore;
	workspaceId: WorkspaceId;
}) {
	const [draft, setDraft] = useState<Record<string, string | boolean>>({});
	const [initialDraft, setInitialDraft] = useState<Record<string, string | boolean>>({});
	const fieldsByKey = useMemo(() => new Map(editor?.fields.map((field) => [field.key, field])), [editor]);

	useEffect(() => {
		if (!editor) return;
		const nextDraft = draftFromEditor(editor);
		setDraft(nextDraft);
		setInitialDraft(nextDraft);
	}, [editor]);

	if (!editor) return <p className="empty-copy">Settings unavailable.</p>;

	const patch = buildSettingsPatch(editor.fields, initialDraft, draft);
	const dirty = Object.keys(patch).length > 0;

	function update(key: string, value: string | boolean): void {
		setDraft((current) => ({ ...current, [key]: value }));
	}

	function save(): void {
		if (!dirty) return;
		void store.updateCommonSettings(workspaceId, patch);
	}

	return (
		<section className="control-section">
			<div className="settings-grid">
				<TextField field={fieldsByKey.get("defaultProvider")} draft={draft} onChange={update} />
				<TextField field={fieldsByKey.get("defaultModel")} draft={draft} onChange={update} />
				<SelectField
					field={fieldsByKey.get("defaultThinkingLevel")}
					draft={draft}
					options={["off", "minimal", "low", "medium", "high", "xhigh"]}
					onChange={update}
				/>
				<TextField field={fieldsByKey.get("enabledModels")} draft={draft} onChange={update} />
				<BooleanField field={fieldsByKey.get("enableSkillCommands")} draft={draft} onChange={update} />
				<SelectField
					field={fieldsByKey.get("steeringMode")}
					draft={draft}
					options={["all", "one-at-a-time"]}
					onChange={update}
				/>
				<SelectField
					field={fieldsByKey.get("followUpMode")}
					draft={draft}
					options={["all", "one-at-a-time"]}
					onChange={update}
				/>
				<SelectField
					field={fieldsByKey.get("defaultProjectTrust")}
					draft={draft}
					options={["ask", "always", "never"]}
					onChange={update}
				/>
				<BooleanField field={fieldsByKey.get("compactionEnabled")} draft={draft} onChange={update} />
				<BooleanField field={fieldsByKey.get("imageAutoResize")} draft={draft} onChange={update} />
				<BooleanField field={fieldsByKey.get("imageBlockImages")} draft={draft} onChange={update} />
			</div>
			<div className="composer-actions">
				<button type="button" onClick={() => void store.openSettingsFile(workspaceId, "global")}>
					Open global
				</button>
				<button type="button" onClick={() => void store.openSettingsFile(workspaceId, "project")}>
					Open project
				</button>
				<button type="button" disabled={!dirty} onClick={save}>
					Save
				</button>
			</div>
		</section>
	);
}

function TextField({
	draft,
	field,
	onChange,
}: {
	draft: Record<string, string | boolean>;
	field: SettingsFieldSnapshot | undefined;
	onChange(key: string, value: string): void;
}) {
	if (!field) return null;
	return (
		<label className="setting-row">
			<span>
				{field.label}
				<small>{field.source}</small>
			</span>
			<input
				value={String(draft[field.key] ?? "")}
				onChange={(event) => onChange(field.key, event.currentTarget.value)}
			/>
		</label>
	);
}

function SelectField({
	draft,
	field,
	onChange,
	options,
}: {
	draft: Record<string, string | boolean>;
	field: SettingsFieldSnapshot | undefined;
	onChange(key: string, value: string): void;
	options: readonly string[];
}) {
	if (!field) return null;
	return (
		<label className="setting-row">
			<span>
				{field.label}
				<small>{field.source}</small>
			</span>
			<select
				value={String(draft[field.key] ?? "")}
				onChange={(event) => onChange(field.key, event.currentTarget.value)}
			>
				{options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		</label>
	);
}

function BooleanField({
	draft,
	field,
	onChange,
}: {
	draft: Record<string, string | boolean>;
	field: SettingsFieldSnapshot | undefined;
	onChange(key: string, value: boolean): void;
}) {
	if (!field) return null;
	return (
		<label className="setting-row setting-row--checkbox">
			<span>
				{field.label}
				<small>{field.source}</small>
			</span>
			<input
				type="checkbox"
				checked={Boolean(draft[field.key])}
				onChange={(event) => onChange(field.key, event.currentTarget.checked)}
			/>
		</label>
	);
}

function ResourcesTab({
	inventory,
	selectedSessionId,
	store,
	workspaceId,
}: {
	inventory: ResourceInventorySnapshot | undefined;
	selectedSessionId: SessionId | undefined;
	store: GuiCatalogStore;
	workspaceId: WorkspaceId;
}) {
	if (!inventory) return <p className="empty-copy">Resources unavailable.</p>;
	return (
		<section className="control-section">
			<div className="composer-actions">
				<button type="button" onClick={() => void store.reloadResources(workspaceId, selectedSessionId)}>
					Reload
				</button>
			</div>
			<ResourceGroup
				title="Skills"
				items={inventory.skills.map((skill) => ({
					id: skill.id,
					title: skill.name,
					detail: skill.description,
					path: skill.filePath,
					source: `${skill.sourceInfo.scope}/${skill.sourceInfo.origin}`,
				}))}
				workspaceId={workspaceId}
				store={store}
			/>
			<ResourceGroup
				title="Extensions"
				items={inventory.extensions.map((extension) => ({
					id: extension.id,
					title: extension.name,
					detail: `${extension.commands} commands, ${extension.tools} tools, ${extension.flags} flags`,
					path: extension.path,
					source: `${extension.sourceInfo.scope}/${extension.sourceInfo.origin}`,
				}))}
				workspaceId={workspaceId}
				store={store}
			/>
			{inventory.extensionErrors.length > 0 ? (
				<div className="diagnostic-list">
					<p className="section-label">Extension errors</p>
					{inventory.extensionErrors.map((error) => (
						<p key={error.id} className="inline-error">
							{error.path}: {error.error}
						</p>
					))}
				</div>
			) : null}
			{inventory.diagnostics.length > 0 ? (
				<div className="diagnostic-list">
					<p className="section-label">Diagnostics</p>
					{inventory.diagnostics.map((diagnostic) => (
						<p key={`${diagnostic.type}:${diagnostic.path ?? ""}:${diagnostic.message}`}>
							{diagnostic.type}: {diagnostic.message}
						</p>
					))}
				</div>
			) : null}
		</section>
	);
}

function ResourceGroup({
	items,
	store,
	title,
	workspaceId,
}: {
	items: ReadonlyArray<{ id: string; title: string; detail: string; path: string; source: string }>;
	store: GuiCatalogStore;
	title: string;
	workspaceId: WorkspaceId;
}) {
	return (
		<div className="resource-list">
			<p className="section-label">{title}</p>
			{items.length === 0 ? <p className="empty-copy">None.</p> : null}
			{items.map((item) => (
				<div key={item.id} className="resource-row">
					<div>
						<strong>{item.title}</strong>
						<p>{item.detail}</p>
						<small>
							{item.source} - {item.path}
						</small>
					</div>
					<div className="button-group">
						<button type="button" onClick={() => void store.openResourceSource(workspaceId, item.id)}>
							Open
						</button>
						<button type="button" onClick={() => void store.revealResourceSource(workspaceId, item.id)}>
							Reveal
						</button>
					</div>
				</div>
			))}
		</div>
	);
}

function draftValue(field: SettingsFieldSnapshot): string | boolean {
	if (Array.isArray(field.effectiveValue)) return field.effectiveValue.join(", ");
	if (typeof field.effectiveValue === "boolean") return field.effectiveValue;
	if (typeof field.effectiveValue === "string") return field.effectiveValue;
	return "";
}

export function draftFromEditor(editor: SettingsEditorSnapshot): Record<string, string | boolean> {
	const draft: Record<string, string | boolean> = {};
	for (const field of editor.fields) {
		draft[field.key] = draftValue(field);
	}
	return draft;
}

export function buildSettingsPatch(
	fields: readonly SettingsFieldSnapshot[],
	initialDraft: Record<string, string | boolean>,
	draft: Record<string, string | boolean>,
): CommonSettingsPatch {
	const patch: SettingsPatchDraft = {};
	for (const field of fields) {
		const key = field.key;
		const value = draft[key];
		const baseline = initialDraft[key];
		if (value === baseline) continue;
		if (key === "defaultProvider" && typeof value === "string" && value.trim()) patch.defaultProvider = value.trim();
		if (key === "defaultModel" && typeof value === "string" && value.trim()) patch.defaultModel = value.trim();
		if (key === "defaultThinkingLevel" && typeof value === "string")
			patch.defaultThinkingLevel = value as CommonSettingsPatch["defaultThinkingLevel"];
		if (key === "enabledModels" && typeof value === "string") {
			patch.enabledModels = value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);
		}
		if (key === "enableSkillCommands" && typeof value === "boolean") patch.enableSkillCommands = value;
		if (key === "steeringMode" && typeof value === "string")
			patch.steeringMode = value as CommonSettingsPatch["steeringMode"];
		if (key === "followUpMode" && typeof value === "string")
			patch.followUpMode = value as CommonSettingsPatch["followUpMode"];
		if (key === "defaultProjectTrust" && typeof value === "string")
			patch.defaultProjectTrust = value as CommonSettingsPatch["defaultProjectTrust"];
		if (key === "compactionEnabled" && typeof value === "boolean") patch.compactionEnabled = value;
		if (key === "imageAutoResize" && typeof value === "boolean") patch.imageAutoResize = value;
		if (key === "imageBlockImages" && typeof value === "boolean") patch.imageBlockImages = value;
	}
	return patch as CommonSettingsPatch;
}

type SettingsPatchDraft = {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: CommonSettingsPatch["defaultThinkingLevel"];
	enabledModels?: string[];
	enableSkillCommands?: boolean;
	steeringMode?: CommonSettingsPatch["steeringMode"];
	followUpMode?: CommonSettingsPatch["followUpMode"];
	defaultProjectTrust?: CommonSettingsPatch["defaultProjectTrust"];
	compactionEnabled?: boolean;
	imageAutoResize?: boolean;
	imageBlockImages?: boolean;
};
