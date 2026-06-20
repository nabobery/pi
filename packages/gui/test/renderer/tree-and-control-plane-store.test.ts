import { describe, expect, test, vi } from "vitest";
import {
	InternalIpcError,
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type GuiCommand,
	type GuiCommandResult,
	type ResourceInventorySnapshot,
	type SessionCompactionSnapshot,
	type SessionTreeSnapshot,
	type SettingsEditorSnapshot,
	type SettingsSummarySnapshot,
	type TimelineSnapshot,
	type TreeNavigationSnapshot,
	type TrustStatusSnapshot,
	type WorkspaceCatalogSnapshot,
} from "../../src/contracts/index.ts";
import { createGuiCatalogStore } from "../../src/renderer/app/app-store.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");
const key = `${workspaceId}:${sessionId}`;

describe("tree and control plane store actions", () => {
	test("loads tree state, applies navigation, and handles cancelled navigation", async () => {
		const tree = treeSnapshot("entry-2");
		const timeline = timelineSnapshot("navigated");
		const invoke = vi.fn(async (command: GuiCommand): Promise<GuiCommandResult> => {
			if (command._tag === "session.getTree") return ok(command, tree);
			if (command._tag === "session.navigateTree") {
				return ok(command, {
					workspaceId,
					sessionId,
					tree,
					timeline,
					editorText: "restore this prompt",
					clearsComposer: false,
					cancelled: false,
				} satisfies TreeNavigationSnapshot);
			}
			if (command._tag === "session.cancelTreeNavigation") return ok(command, undefined);
			throw new Error(`Unexpected command ${command._tag}`);
		});
		const store = createStore(invoke);

		await store.getTree(workspaceId, sessionId);
		expect(store.getSnapshot().treeNavigator).toMatchObject({
			error: undefined,
			loading: false,
			selectedEntryId: "entry-2",
		});
		expect(store.getSnapshot().treesBySessionKey[key]).toEqual(tree);

		await store.navigateTree({
			workspaceId,
			sessionId,
			targetEntryId: "entry-1",
			summaryMode: "custom",
			customInstructions: "  keep decisions  ",
		});
		expect(invoke.mock.calls.at(-1)?.[0]).toMatchObject({
			_tag: "session.navigateTree",
			customInstructions: "keep decisions",
		});
		expect(store.getSnapshot().timelines[key]).toEqual(timeline);
		expect(store.getSnapshot().composerDrafts[key]).toBe("restore this prompt");
		expect(store.getSnapshot().treeNavigator.navigationPending).toBe(false);

		store.openTreeNavigator(workspaceId, sessionId);
		await settleAsyncUpdates();
		await store.cancelTreeNavigation(workspaceId, sessionId);
		expect(store.getSnapshot().treeNavigator).toMatchObject({
			navigationCancelling: false,
			navigationPending: false,
		});
	});

	test("compacts sessions and records errors without losing dialog state", async () => {
		const compaction = {
			workspaceId,
			sessionId,
			summary: "summary",
			timeline: timelineSnapshot("compacted"),
			tree: treeSnapshot("entry-1"),
			cancelled: false,
		} satisfies SessionCompactionSnapshot;
		const invoke = vi.fn(async (command: GuiCommand): Promise<GuiCommandResult> => {
			if (command._tag === "session.compact") return ok(command, compaction);
			if (command._tag === "session.cancelCompaction") return failed(command, "cancel failed");
			throw new Error(`Unexpected command ${command._tag}`);
		});
		const store = createStore(invoke);

		store.openCompactDialog(workspaceId, sessionId);
		store.setCompactInstructions(" preserve current task ");
		await store.compactSession(workspaceId, sessionId, " preserve current task ");

		expect(invoke.mock.calls[0][0]).toMatchObject({
			_tag: "session.compact",
			customInstructions: "preserve current task",
		});
		expect(store.getSnapshot().compactDialog).toMatchObject({
			compacting: false,
			error: undefined,
			lastResult: compaction,
			open: false,
		});
		expect(store.getSnapshot().timelines[key]).toEqual(compaction.timeline);

		await store.cancelCompaction(workspaceId, sessionId);
		expect(store.getSnapshot().compactDialog).toMatchObject({
			cancelling: false,
			error: "cancel failed",
		});
	});

	test("loads control plane tabs and applies targeted resource/settings updates", async () => {
		const invoke = vi.fn(async (command: GuiCommand): Promise<GuiCommandResult> => {
			if (command._tag === "settings.getSummary") return ok(command, settingsSummary("openai"));
			if (command._tag === "settings.getEditorSnapshot") return ok(command, settingsEditor("openai"));
			if (command._tag === "trust.getStatus") return ok(command, trustStatus(false));
			if (command._tag === "resources.getInventory") return ok(command, resourceInventory(["skill-a"]));
			if (command._tag === "trust.saveDecision") return ok(command, trustStatus(true));
			if (command._tag === "resources.reload") return ok(command, resourceInventory(["skill-a", "skill-b"]));
			if (command._tag === "settings.updateCommon") return ok(command, settingsSummary("anthropic"));
			if (command._tag === "resources.openSource" || command._tag === "resources.revealSource")
				return ok(command, undefined);
			throw new Error(`Unexpected command ${command._tag}`);
		});
		const store = createStore(invoke);

		await store.openControlPlane("trust", workspaceId, sessionId);
		expect(store.getSnapshot().controlPlane).toMatchObject({
			error: undefined,
			loading: false,
			open: true,
			tab: "trust",
		});
		expect(store.getSnapshot().settingsSummaryByWorkspaceId[workspaceId].defaultProvider).toBe("openai");
		expect(store.getSnapshot().settingsEditorByWorkspaceId[workspaceId].fields[0].effectiveValue).toBe("openai");
		expect(store.getSnapshot().trustStatusByWorkspaceId[workspaceId].trusted).toBe(false);
		expect(store.getSnapshot().resourceInventoryByWorkspaceId[workspaceId].skills).toHaveLength(1);

		await store.saveTrustDecision(workspaceId, "always");
		await store.reloadResources(workspaceId, sessionId);
		await store.updateCommonSettings(workspaceId, { defaultProvider: "anthropic" });
		await store.openResourceSource(workspaceId, "skill-a");
		await store.revealResourceSource(workspaceId, "skill-a");

		expect(store.getSnapshot().trustStatusByWorkspaceId[workspaceId].trusted).toBe(true);
		expect(store.getSnapshot().resourceInventoryByWorkspaceId[workspaceId].skills).toHaveLength(2);
		expect(store.getSnapshot().settingsSummaryByWorkspaceId[workspaceId].defaultProvider).toBe("anthropic");
		expect(store.getSnapshot().controlPlane.error).toBeUndefined();
	});

	test("reports partial control-plane load failures", async () => {
		const invoke = vi.fn(async (command: GuiCommand): Promise<GuiCommandResult> => {
			if (command._tag === "settings.getSummary") return ok(command, settingsSummary("openai"));
			return failed(command, "resources unavailable");
		});
		const store = createStore(invoke);

		await store.openControlPlane("resources", workspaceId, undefined);

		expect(store.getSnapshot().controlPlane).toMatchObject({
			error: "resources unavailable",
			loading: false,
			open: true,
			tab: "resources",
		});
	});
});

function createStore(invoke: (command: GuiCommand) => Promise<GuiCommandResult>) {
	return createGuiCatalogStore(
		{
			invoke,
			subscribe: () => () => undefined,
		},
		workspaceCatalog(),
	);
}

function ok(command: GuiCommand, data: unknown): GuiCommandResult {
	return { ok: true, requestId: command.requestId, data };
}

function failed(command: GuiCommand, message: string): GuiCommandResult {
	return {
		ok: false,
		requestId: command.requestId,
		error: new InternalIpcError({ message }),
	};
}

async function settleAsyncUpdates(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function workspaceCatalog(): WorkspaceCatalogSnapshot {
	return {
		revision: catalogRevisionFromString("0"),
		selectedWorkspaceId: workspaceId,
		workspaces: [
			{
				id: workspaceId,
				path: "/tmp/workspace",
				name: "workspace",
				lastOpenedAt: "2026-06-20T00:00:00.000Z",
				sortOrder: 0,
				missing: false,
				selected: true,
			},
		],
	};
}

function treeSnapshot(leafEntryId: string): SessionTreeSnapshot {
	return {
		workspaceId,
		sessionId,
		leafEntryId,
		entries: [
			{
				entryId: "entry-1",
				parentId: null,
				childIds: ["entry-2"],
				depth: 0,
				kind: "user",
				textPreview: "hello",
				isActiveLeaf: leafEntryId === "entry-1",
				isActivePath: true,
				hasChildren: true,
				searchText: "hello",
			},
			{
				entryId: "entry-2",
				parentId: "entry-1",
				childIds: [],
				depth: 1,
				kind: "assistant",
				textPreview: "world",
				isActiveLeaf: leafEntryId === "entry-2",
				isActivePath: leafEntryId === "entry-2",
				hasChildren: false,
				searchText: "world",
			},
		],
		updatedAt: "2026-06-20T00:00:00.000Z",
	};
}

function timelineSnapshot(text: string): TimelineSnapshot {
	return {
		workspaceId,
		sessionId,
		entries: [{ id: "entry-1", kind: "assistant", text }],
	};
}

function settingsSummary(defaultProvider: string): SettingsSummarySnapshot {
	return {
		workspaceId,
		globalSettingsPath: "/tmp/.pi/settings.json",
		projectSettingsPath: "/tmp/workspace/.pi/settings.json",
		defaultProvider,
		defaultModel: "model",
		defaultThinkingLevel: "off",
		enableSkillCommands: true,
		imageAutoResize: true,
		imageBlockImages: false,
		steeringMode: "all",
		followUpMode: "all",
		defaultProjectTrust: "ask",
		settingsDiagnostics: [],
	};
}

function settingsEditor(defaultProvider: string): SettingsEditorSnapshot {
	return {
		workspaceId,
		globalSettingsPath: "/tmp/.pi/settings.json",
		projectSettingsPath: "/tmp/workspace/.pi/settings.json",
		updatedAt: "2026-06-20T00:00:00.000Z",
		settingsDiagnostics: [],
		fields: [
			{
				key: "defaultProvider",
				label: "Default provider",
				source: "global",
				effectiveValue: defaultProvider,
				globalValue: defaultProvider,
			},
		],
	};
}

function trustStatus(trusted: boolean): TrustStatusSnapshot {
	return {
		workspaceId,
		cwd: "/tmp/workspace",
		trusted,
		source: "saved",
		requiresTrust: true,
		options: [
			{
				id: "always",
				label: "Always",
				trusted: true,
				updates: [{ path: "/tmp/workspace/.pi/trust.json", decision: true }],
			},
		],
	};
}

function resourceInventory(skillIds: readonly string[]): ResourceInventorySnapshot {
	return {
		workspaceId,
		sessionId,
		skills: skillIds.map((id) => ({
			id,
			name: id,
			description: "Skill",
			filePath: `/tmp/${id}/SKILL.md`,
			baseDir: `/tmp/${id}`,
			disableModelInvocation: false,
			sourceInfo: {
				path: `/tmp/${id}/SKILL.md`,
				source: id,
				scope: "project",
				origin: "top-level",
			},
		})),
		extensions: [],
		extensionErrors: [],
		diagnostics: [],
		updatedAt: "2026-06-20T00:00:00.000Z",
	};
}
