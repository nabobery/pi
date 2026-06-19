import { describe, expect, test, vi } from "vitest";
import {
	SlashCommandCatalogUnavailable,
	sessionIdFromString,
	type SlashCommandSnapshot,
	workspaceIdFromString,
} from "../../../src/contracts/index.ts";
import { SlashCommandService } from "../../../src/main/session/slash-command-service.ts";

describe("SlashCommandService", () => {
	test("merges built-in and dynamic commands with availability", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const dynamicCommands: SlashCommandSnapshot[] = [
			{
				name: "extension-command",
				description: "Extension command",
				source: "extension",
				sourceInfo: {
					path: "extension.ts",
					source: "test",
					scope: "temporary",
					origin: "top-level",
				},
				availability: "sendable",
			},
			{
				name: "resume",
				description: "Conflicting command",
				source: "extension",
				sourceInfo: {
					path: "conflict.ts",
					source: "test",
					scope: "temporary",
					origin: "top-level",
				},
				availability: "sendable",
			},
		];
		const service = new SlashCommandService({
			now: () => new Date("2026-06-19T00:00:00.000Z"),
			sessionSupervisor: {
				getSlashCommands: vi.fn(async () => dynamicCommands),
			},
		});

		const catalog = await service.getCatalog(workspaceId, sessionId);

		expect(catalog).toMatchObject({ workspaceId, sessionId, updatedAt: "2026-06-19T00:00:00.000Z" });
		expect(catalog.commands).toContainEqual(
			expect.objectContaining({ name: "resume", source: "builtin", availability: "guiAction" }),
		);
		expect(catalog.commands).toContainEqual(
			expect.objectContaining({ name: "name", source: "builtin", availability: "guiAction" }),
		);
		expect(catalog.commands).toContainEqual(
			expect.objectContaining({ name: "extension-command", source: "extension", availability: "sendable" }),
		);
		expect(catalog.commands).toContainEqual(
			expect.objectContaining({ name: "resume", source: "extension", availability: "conflict" }),
		);
		expect(catalog.commands).toContainEqual(
			expect.objectContaining({ name: "tree", source: "builtin", availability: "guiAction" }),
		);
		expect(catalog.commands).toContainEqual(
			expect.objectContaining({ name: "compact", source: "builtin", availability: "guiAction" }),
		);
	});

	test("wraps dynamic command discovery failures in a typed error", async () => {
		const service = new SlashCommandService({
			sessionSupervisor: {
				getSlashCommands: vi.fn(async () => {
					throw new Error("runtime unavailable");
				}),
			},
		});

		await expect(
			service.getCatalog(workspaceIdFromString("workspace-1"), sessionIdFromString("session-1")),
		).rejects.toBeInstanceOf(SlashCommandCatalogUnavailable);
	});
});
