import { describe, expect, test, vi } from "vitest";
import { CatalogParseFailed, catalogRevisionFromString, requestIdFromString } from "../../src/contracts/index.ts";
import { loadBootstrapState } from "../../src/renderer/app/bootstrap-loader.ts";

describe("loadBootstrapState", () => {
	test("returns ready state for valid bootstrap data", async () => {
		const invoke = vi.fn().mockResolvedValue({
			ok: true,
			requestId: requestIdFromString("renderer-bootstrap"),
			data: {
				appInfo: {
					name: "Pi GUI",
					version: "1.2.3",
					mode: "test",
				},
			},
		});

		await expect(loadBootstrapState({ invoke })).resolves.toEqual({
			status: "ready",
			appInfo: {
				name: "Pi GUI",
				version: "1.2.3",
				mode: "test",
			},
			workspaceCatalog: {
				revision: catalogRevisionFromString("0"),
				workspaces: [],
			},
			warnings: [],
		});
	});

	test("returns bootstrap warnings for recoverable startup errors", async () => {
		const warning = new CatalogParseFailed({
			message: "Failed to parse GUI catalog",
			backupPath: "/tmp/catalog.invalid",
		});
		const invoke = vi.fn().mockResolvedValue({
			ok: true,
			requestId: requestIdFromString("renderer-bootstrap"),
			data: {
				appInfo: {
					name: "Pi GUI",
					version: "1.2.3",
					mode: "test",
				},
				warnings: [warning],
			},
		});

		await expect(loadBootstrapState({ invoke })).resolves.toEqual({
			status: "ready",
			appInfo: {
				name: "Pi GUI",
				version: "1.2.3",
				mode: "test",
			},
			workspaceCatalog: {
				revision: catalogRevisionFromString("0"),
				workspaces: [],
			},
			warnings: [warning],
		});
	});

	test("returns failed state when successful bootstrap data is malformed", async () => {
		const invoke = vi.fn().mockResolvedValue({
			ok: true,
			requestId: requestIdFromString("renderer-bootstrap"),
			data: { appInfo: { name: "Pi GUI" } },
		});

		await expect(loadBootstrapState({ invoke })).resolves.toEqual({
			status: "failed",
			message: "Invalid bootstrap response",
		});
	});
});
