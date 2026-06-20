/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type CatalogRevision,
	type ResourceInventorySnapshot,
	type SettingsEditorSnapshot,
	type SettingsFieldSnapshot,
	type TrustStatusSnapshot,
} from "../../src/contracts/index.ts";
import { ControlPlaneDialog, buildSettingsPatch, draftFromEditor } from "../../src/renderer/app/control-plane.tsx";
import {
	createGuiCatalogStore,
	type CatalogViewState,
	type GuiCatalogStore,
} from "../../src/renderer/app/app-store.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");

describe("ControlPlaneDialog settings patching", () => {
	test("does not write project-effective values to global settings when the draft is unchanged", () => {
		const editor: SettingsEditorSnapshot = {
			workspaceId: workspaceIdFromString("workspace-1"),
			globalSettingsPath: "/tmp/agent/settings.json",
			projectSettingsPath: "/tmp/workspace/.pi/settings.json",
			updatedAt: "2026-06-20T00:00:00.000Z",
			settingsDiagnostics: [],
			fields: [
				{
					key: "defaultProvider",
					label: "Default provider",
					source: "project",
					effectiveValue: "project-provider",
					globalValue: "global-provider",
					projectValue: "project-provider",
				},
				{
					key: "enableSkillCommands",
					label: "Skill commands",
					source: "project",
					effectiveValue: false,
					globalValue: true,
					projectValue: false,
				},
			],
		};
		const initialDraft = draftFromEditor(editor);

		expect(buildSettingsPatch(editor.fields, initialDraft, initialDraft)).toEqual({});
	});

	test("builds patches for all common setting field kinds", () => {
		const fields: SettingsFieldSnapshot[] = [
			field("defaultProvider", "Default provider", "openai"),
			field("defaultModel", "Default model", "gpt-5"),
			field("defaultThinkingLevel", "Thinking", "off"),
			field("enabledModels", "Enabled models", ["openai/gpt-5", "anthropic/claude"]),
			field("enableSkillCommands", "Skill commands", true),
			field("steeringMode", "Steering", "all"),
			field("followUpMode", "Follow-up", "all"),
			field("defaultProjectTrust", "Trust", "ask"),
			field("compactionEnabled", "Compaction", true),
			field("imageAutoResize", "Resize", true),
			field("imageBlockImages", "Block images", false),
		];
		const initialDraft = Object.fromEntries(
			fields.map((entry) => [entry.key, draftFromEditor(editorFromFields([entry]))[entry.key]]),
		);

		expect(
			buildSettingsPatch(fields, initialDraft, {
				defaultProvider: " anthropic ",
				defaultModel: " claude ",
				defaultThinkingLevel: "high",
				enabledModels: "openai/gpt-5, anthropic/claude, ",
				enableSkillCommands: false,
				steeringMode: "one-at-a-time",
				followUpMode: "one-at-a-time",
				defaultProjectTrust: "always",
				compactionEnabled: false,
				imageAutoResize: false,
				imageBlockImages: true,
			}),
		).toEqual({
			defaultProvider: "anthropic",
			defaultModel: "claude",
			defaultThinkingLevel: "high",
			enabledModels: ["openai/gpt-5", "anthropic/claude"],
			enableSkillCommands: false,
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
			defaultProjectTrust: "always",
			compactionEnabled: false,
			imageAutoResize: false,
			imageBlockImages: true,
		});
	});

	test("normalizes editor draft values for array, boolean, string, and null fields", () => {
		expect(
			draftFromEditor(
				editorFromFields([
					field("enabledModels", "Enabled models", ["openai/gpt-5", "anthropic/claude"]),
					field("enableSkillCommands", "Skill commands", true),
					field("defaultProvider", "Default provider", "openai"),
					field("defaultModel", "Default model", null),
				]),
			),
		).toEqual({
			enabledModels: "openai/gpt-5, anthropic/claude",
			enableSkillCommands: true,
			defaultProvider: "openai",
			defaultModel: "",
		});
	});
});

describe("ControlPlaneDialog", () => {
	test("renders trust, settings, and resource tabs with loaded data", () => {
		const store = storeStub();
		const base = stateSnapshot();

		const trustMarkup = renderToStaticMarkup(
			<ControlPlaneDialog
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={{
					...base,
					controlPlane: { open: true, tab: "trust", loading: false, error: undefined },
					trustStatusByWorkspaceId: { [workspaceId]: trustStatus() },
				}}
				store={store}
			/>,
		);
		expect(trustMarkup).toContain("Control Plane");
		expect(trustMarkup).toContain("not trusted");
		expect(trustMarkup).toContain("Apply");

		const settingsMarkup = renderToStaticMarkup(
			<ControlPlaneDialog
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={{
					...base,
					controlPlane: { open: true, tab: "settings", loading: true, error: "settings warning" },
					settingsEditorByWorkspaceId: {
						[workspaceId]: editorFromFields([field("defaultProvider", "Default provider", "openai")]),
					},
				}}
				store={store}
			/>,
		);
		expect(settingsMarkup).toContain("Loading.");
		expect(settingsMarkup).toContain("settings warning");
		expect(settingsMarkup).toContain("Default provider");
		expect(settingsMarkup).toContain("Open global");

		const resourcesMarkup = renderToStaticMarkup(
			<ControlPlaneDialog
				selectedSessionId={sessionId}
				selectedWorkspaceId={workspaceId}
				state={{
					...base,
					controlPlane: { open: true, tab: "resources", loading: false, error: undefined },
					resourceInventoryByWorkspaceId: { [workspaceId]: resourceInventory() },
				}}
				store={store}
			/>,
		);
		expect(resourcesMarkup).toContain("Reload");
		expect(resourcesMarkup).toContain("Skill");
		expect(resourcesMarkup).toContain("Extension errors");
		expect(resourcesMarkup).toContain("warning: duplicate skill");
	});

	test("renders empty states and suppresses closed dialogs", () => {
		const store = storeStub();
		const base = stateSnapshot();

		expect(
			renderToStaticMarkup(
				<ControlPlaneDialog
					selectedSessionId={undefined}
					selectedWorkspaceId={workspaceId}
					state={{ ...base, controlPlane: { open: true, tab: "trust", loading: false, error: undefined } }}
					store={store}
				/>,
			),
		).toContain("Trust status unavailable.");
		expect(
			renderToStaticMarkup(
				<ControlPlaneDialog
					selectedSessionId={undefined}
					selectedWorkspaceId={workspaceId}
					state={{ ...base, controlPlane: { open: true, tab: "settings", loading: false, error: undefined } }}
					store={store}
				/>,
			),
		).toContain("Settings unavailable.");
		expect(
			renderToStaticMarkup(
				<ControlPlaneDialog
					selectedSessionId={undefined}
					selectedWorkspaceId={workspaceId}
					state={{ ...base, controlPlane: { open: true, tab: "resources", loading: false, error: undefined } }}
					store={store}
				/>,
			),
		).toContain("Resources unavailable.");
		expect(
			renderToStaticMarkup(
				<ControlPlaneDialog
					selectedSessionId={undefined}
					selectedWorkspaceId={workspaceId}
					state={{ ...base, controlPlane: { open: false, tab: "resources", loading: false, error: undefined } }}
					store={store}
				/>,
			),
		).toBe("");
		expect(
			renderToStaticMarkup(
				<ControlPlaneDialog
					selectedSessionId={undefined}
					selectedWorkspaceId={undefined}
					state={{ ...base, controlPlane: { open: true, tab: "resources", loading: false, error: undefined } }}
					store={store}
				/>,
			),
		).toBe("");
	});

	test("routes resource button actions to the store", () => {
		const store = storeStub();
		const rootElement = document.createElement("div");
		document.body.append(rootElement);
		const root = createRoot(rootElement);
		try {
			act(() =>
				root.render(
					<ControlPlaneDialog
						selectedSessionId={sessionId}
						selectedWorkspaceId={workspaceId}
						state={{
							...stateSnapshot(),
							controlPlane: { open: true, tab: "resources", loading: false, error: undefined },
							resourceInventoryByWorkspaceId: { [workspaceId]: resourceInventory() },
						}}
						store={store}
					/>,
				),
			);

			const buttons = Array.from(rootElement.querySelectorAll("button"));
			clickButton(buttons, "Reload");
			clickButton(buttons, "Open");
			clickButton(buttons, "Reveal");

			expect(store.reloadResources).toHaveBeenCalledWith(workspaceId, sessionId);
			expect(store.openResourceSource).toHaveBeenCalledWith(workspaceId, "skill-1");
			expect(store.revealResourceSource).toHaveBeenCalledWith(workspaceId, "skill-1");
		} finally {
			act(() => root.unmount());
			rootElement.remove();
		}
	});
});

function field(
	key: string,
	label: string,
	effectiveValue: SettingsFieldSnapshot["effectiveValue"],
): SettingsFieldSnapshot {
	return {
		key,
		label,
		source: "global",
		effectiveValue,
		globalValue: effectiveValue,
	};
}

function editorFromFields(fields: SettingsFieldSnapshot[]): SettingsEditorSnapshot {
	return {
		workspaceId,
		globalSettingsPath: "/tmp/.pi/settings.json",
		projectSettingsPath: "/tmp/workspace/.pi/settings.json",
		updatedAt: "2026-06-20T00:00:00.000Z",
		settingsDiagnostics: [],
		fields,
	};
}

function stateSnapshot(): CatalogViewState {
	return createGuiCatalogStore(
		{
			invoke: async (command) => ({ ok: true, requestId: command.requestId, data: undefined }),
			subscribe: () => () => undefined,
		},
		{
			revision: catalogRevisionFromString("0") as CatalogRevision,
			selectedWorkspaceId: workspaceId,
			workspaces: [],
		},
	).getSnapshot();
}

function storeStub(): GuiCatalogStore {
	const store = createGuiCatalogStore(
		{
			invoke: async (command) => ({ ok: true, requestId: command.requestId, data: undefined }),
			subscribe: () => () => undefined,
		},
		{
			revision: catalogRevisionFromString("0"),
			selectedWorkspaceId: workspaceId,
			workspaces: [],
		},
	);
	store.reloadResources = viFnAsync();
	store.openResourceSource = viFnAsync();
	store.revealResourceSource = viFnAsync();
	return store;
}

function clickButton(buttons: HTMLButtonElement[], label: string): void {
	const button = buttons.find((entry) => entry.textContent === label);
	if (!button) throw new Error(`Expected ${label} button`);
	act(() => button.click());
}

function viFnAsync() {
	return vi.fn(async () => undefined);
}

function trustStatus(): TrustStatusSnapshot {
	return {
		workspaceId,
		cwd: "/tmp/workspace",
		trusted: false,
		source: "saved",
		savedPath: "/tmp/workspace/.pi/trust.json",
		requiresTrust: true,
		options: [{ id: "always", label: "Always", trusted: true, updates: [] }],
	};
}

function resourceInventory(): ResourceInventorySnapshot {
	return {
		workspaceId,
		sessionId,
		skills: [
			{
				id: "skill-1",
				name: "Skill",
				description: "Useful skill",
				filePath: "/tmp/SKILL.md",
				baseDir: "/tmp",
				disableModelInvocation: false,
				sourceInfo: { path: "/tmp/SKILL.md", source: "skill", scope: "project", origin: "top-level" },
			},
		],
		extensions: [
			{
				id: "extension-1",
				name: "Extension",
				path: "/tmp/ext.ts",
				sourceInfo: { path: "/tmp/ext.ts", source: "ext", scope: "temporary", origin: "package" },
				commands: 1,
				tools: 2,
				flags: 3,
			},
		],
		extensionErrors: [{ id: "bad", path: "/tmp/bad.ts", error: "failed" }],
		diagnostics: [{ type: "warning", message: "duplicate skill", path: "/tmp/SKILL.md" }],
		updatedAt: "2026-06-20T00:00:00.000Z",
	};
}
