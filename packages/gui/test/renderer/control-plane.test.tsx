import { describe, expect, test } from "vitest";
import { workspaceIdFromString, type SettingsEditorSnapshot } from "../../src/contracts/index.ts";
import { buildSettingsPatch, draftFromEditor } from "../../src/renderer/app/control-plane.tsx";

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
});
