import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { catalogRevisionFromString, sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import { JsonCatalogStore } from "../../../src/main/catalog/json-catalog-store.ts";

describe("JsonCatalogStore", () => {
	let tempDir: string;
	let catalogPath: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `pi-gui-catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		await mkdir(tempDir, { recursive: true });
		catalogPath = join(tempDir, "catalog.json");
	});

	test("returns empty state when the catalog file is missing", async () => {
		const store = new JsonCatalogStore({ catalogPath });

		await expect(store.read()).resolves.toEqual({
			version: 1,
			revision: catalogRevisionFromString("0"),
			workspaces: [],
			sessions: [],
			selectedSessionByWorkspace: {},
		});
	});

	test("decodes valid catalog JSON", async () => {
		await writeFile(
			catalogPath,
			`${JSON.stringify({
				version: 1,
				revision: "3",
				selectedWorkspaceId: "workspace-1",
				selectedSessionByWorkspace: { "workspace-1": "session-1" },
				workspaces: [
					{
						id: "workspace-1",
						path: tempDir,
						name: "Project",
						lastOpenedAt: "2026-06-18T00:00:00.000Z",
						sortOrder: 0,
						missing: false,
						selected: true,
					},
				],
				sessions: [
					{
						id: "session-1",
						workspaceId: "workspace-1",
						title: "Existing session",
						status: "idle",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "Hello",
						messageCount: 1,
						sessionFilePath: join(tempDir, "session.jsonl"),
					},
				],
			})}\n`,
			"utf8",
		);
		const store = new JsonCatalogStore({ catalogPath });

		const state = await store.read();

		expect(state.selectedWorkspaceId).toBe("workspace-1");
		expect(state.workspaces).toHaveLength(1);
		expect(state.sessions).toHaveLength(1);
	});

	test("backs up malformed JSON and returns an empty state", async () => {
		await writeFile(catalogPath, "{not-json", "utf8");
		const store = new JsonCatalogStore({ catalogPath });

		const state = await store.read();

		expect(state.workspaces).toEqual([]);
		expect(store.getStartupWarning()).toMatchObject({
			_tag: "CatalogParseFailed",
			backupPath: expect.any(String),
		});
		const files = await readdir(tempDir);
		expect(files.some((file) => file.startsWith("catalog.json.") && file.endsWith(".invalid"))).toBe(true);
	});

	test("serializes concurrent writes", async () => {
		const store = new JsonCatalogStore({ catalogPath });
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await Promise.all([
			store.update((state) => ({
				...state,
				revision: catalogRevisionFromString("1"),
				workspaces: [
					{
						id: workspaceId,
						path: tempDir,
						name: "Project",
						lastOpenedAt: "2026-06-18T00:00:00.000Z",
						sortOrder: 0,
						missing: false,
						selected: true,
					},
				],
			})),
			store.update((state) => ({
				...state,
				revision: catalogRevisionFromString("2"),
				selectedSessionByWorkspace: { [workspaceId]: sessionId },
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session",
						status: "idle",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "",
						messageCount: 0,
					},
				],
			})),
		]);

		const raw = JSON.parse(await readFile(catalogPath, "utf8")) as { workspaces: unknown[]; sessions: unknown[] };
		expect(raw.workspaces).toHaveLength(1);
		expect(raw.sessions).toHaveLength(1);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});
});
