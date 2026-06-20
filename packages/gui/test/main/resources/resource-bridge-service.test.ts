import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { catalogRevisionFromString, sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { ResourceBridgeService } from "../../../src/main/resources/resource-bridge-service.ts";

describe("ResourceBridgeService", () => {
	test("loads workspace inventory from Pi resource loader and opens sources by resource id", async () => {
		const fixture = await createFixture();
		try {
			const skillPath = join(fixture.agentDir, "skills", "demo", "SKILL.md");
			await mkdir(join(fixture.agentDir, "skills", "demo"), { recursive: true });
			await writeFile(
				skillPath,
				"---\nname: demo\ndescription: Demo skill\n---\nUse this skill for demos.\n",
				"utf8",
			);
			const shell = {
				openPath: vi.fn(async () => ""),
				showItemInFolder: vi.fn(() => undefined),
			};
			const service = new ResourceBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
				shell,
			});

			const inventory = await service.getInventory(workspaceIdFromString("workspace-1"), undefined);
			const skill = inventory.skills.find((entry) => entry.name === "demo");
			if (!skill) throw new Error("Expected demo skill");
			await service.openSource(workspaceIdFromString("workspace-1"), skill.id);
			await service.revealSource(workspaceIdFromString("workspace-1"), skill.id);

			expect(skill.filePath).toBe(skillPath);
			expect(shell.openPath).toHaveBeenCalledWith(skillPath);
			expect(shell.showItemInFolder).toHaveBeenCalledWith(skillPath);
		} finally {
			await fixture.dispose();
		}
	});

	test("delegates active session reloads to the session supervisor", async () => {
		const fixture = await createFixture();
		try {
			const inventory = {
				workspaceId: workspaceIdFromString("workspace-1"),
				sessionId: sessionIdFromString("session-1"),
				skills: [],
				extensions: [],
				extensionErrors: [],
				diagnostics: [],
				updatedAt: "2026-06-20T00:00:00.000Z",
			};
			const sessionSupervisor = {
				reloadResources: vi.fn(async () => inventory),
			};
			const service = new ResourceBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
				sessionSupervisor,
			});

			const result = await service.reload(workspaceIdFromString("workspace-1"), sessionIdFromString("session-1"));

			expect(result).toBe(inventory);
			expect(sessionSupervisor.reloadResources).toHaveBeenCalledWith("workspace-1", "session-1");
		} finally {
			await fixture.dispose();
		}
	});
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-gui-resources-"));
	const agentDir = join(root, "agent");
	const workspaceDir = join(root, "workspace");
	await mkdir(workspaceDir, { recursive: true });
	const catalogService = {
		getWorkspaceCatalog: async () => ({
			revision: catalogRevisionFromString("1"),
			selectedWorkspaceId: workspaceIdFromString("workspace-1"),
			workspaces: [
				{
					id: workspaceIdFromString("workspace-1"),
					path: workspaceDir,
					name: "workspace",
					lastOpenedAt: "2026-06-20T00:00:00.000Z",
					sortOrder: 0,
					missing: false,
				},
			],
		}),
	};
	return {
		agentDir,
		catalogService,
		dispose: () => rm(root, { recursive: true, force: true }),
		workspaceDir,
	};
}
