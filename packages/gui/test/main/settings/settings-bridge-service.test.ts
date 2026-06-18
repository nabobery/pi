import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { catalogRevisionFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { SettingsBridgeService } from "../../../src/main/settings/settings-bridge-service.ts";

describe("SettingsBridgeService", () => {
	test("computes settings paths only from catalog workspaces", async () => {
		const fixture = await createFixture();
		try {
			const service = new SettingsBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
			});

			const summary = await service.getSummary(workspaceIdFromString("workspace-1"));

			expect(summary.globalSettingsPath).toBe(join(fixture.agentDir, "settings.json"));
			expect(summary.projectSettingsPath).toBe(join(fixture.workspaceDir, ".pi", "settings.json"));
			await expect(service.getSummary(workspaceIdFromString("missing-workspace"))).rejects.toMatchObject({
				_tag: "SettingsSummaryReadFailed",
				cause: expect.stringContaining("Workspace missing-workspace is not in the GUI catalog"),
			});
		} finally {
			await fixture.dispose();
		}
	});

	test("preserves null trust updates for parent trust options", async () => {
		const fixture = await createFixture();
		try {
			const service = new SettingsBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
			});

			const trust = await service.getTrustStatus(workspaceIdFromString("workspace-1"));

			expect(trust.options.some((option) => option.updates.some((update) => update.decision === null))).toBe(true);
		} finally {
			await fixture.dispose();
		}
	});

	test("fails missing workspace trust lookups with typed GUI errors", async () => {
		const fixture = await createFixture();
		try {
			const service = new SettingsBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
			});

			await expect(service.getTrustStatus(workspaceIdFromString("missing-workspace"))).rejects.toMatchObject({
				_tag: "TrustStatusReadFailed",
				cause: expect.stringContaining("Workspace missing-workspace is not in the GUI catalog"),
			});
		} finally {
			await fixture.dispose();
		}
	});

	test("open and reveal require an explicit shell adapter", async () => {
		const fixture = await createFixture();
		try {
			await mkdir(fixture.agentDir, { recursive: true });
			await writeFile(join(fixture.agentDir, "settings.json"), "{}\n", "utf8");
			const service = new SettingsBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
			});

			await expect(service.openSettingsFile(workspaceIdFromString("workspace-1"), "global")).rejects.toMatchObject({
				_tag: "SettingsFileOpenFailed",
				cause: "Pi settings shell adapter is not available",
			});
		} finally {
			await fixture.dispose();
		}
	});

	test("open and reveal use only computed settings paths", async () => {
		const fixture = await createFixture();
		try {
			await mkdir(fixture.agentDir, { recursive: true });
			const globalSettingsPath = join(fixture.agentDir, "settings.json");
			await writeFile(globalSettingsPath, "{}\n", "utf8");
			const shell = {
				openPath: vi.fn(async () => ""),
				showItemInFolder: vi.fn(() => undefined),
			};
			const service = new SettingsBridgeService({
				catalogService: fixture.catalogService,
				getAgentDir: () => fixture.agentDir,
				shell,
			});

			await service.openSettingsFile(workspaceIdFromString("workspace-1"), "global");
			await service.revealSettingsFile(workspaceIdFromString("workspace-1"), "global");

			expect(shell.openPath).toHaveBeenCalledWith(globalSettingsPath);
			expect(shell.showItemInFolder).toHaveBeenCalledWith(globalSettingsPath);
		} finally {
			await fixture.dispose();
		}
	});
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-gui-settings-"));
	const agentDir = join(root, "agent");
	const workspaceDir = join(root, "workspace");
	const catalogService = {
		getWorkspaceCatalog: async () => ({
			revision: catalogRevisionFromString("1"),
			selectedWorkspaceId: workspaceIdFromString("workspace-1"),
			workspaces: [
				{
					id: workspaceIdFromString("workspace-1"),
					path: workspaceDir,
					name: "workspace",
					lastOpenedAt: "2026-06-18T00:00:00.000Z",
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
