import { describe, expect, test, vi } from "vitest";
import { SessionExportUnavailable, sessionIdFromString, workspaceIdFromString } from "../../../src/contracts/index.ts";
import {
	exportReadySession,
	type ManagedSessionRecordForExport,
	type SessionArtifactTracker,
} from "../../../src/main/session/session-export.ts";
import type { RuntimeSessionHandle, SessionDriver } from "../../../src/main/session/session-driver.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");

describe("exportReadySession", () => {
	test("exports an idle session and tracks the generated file artifact", async () => {
		const driver = createDriver("/tmp/session.html");
		const tracker: SessionArtifactTracker = { trackFile: vi.fn(() => "artifact-1") };
		const record = createRecord();

		const exported = await exportReadySession(driver, tracker, record, "html", "/tmp/out.html");

		expect(driver.exportSession).toHaveBeenCalledWith(record.handle, {
			format: "html",
			outputPath: "/tmp/out.html",
		});
		expect(tracker.trackFile).toHaveBeenCalledWith("/tmp/session.html");
		expect(exported).toMatchObject({
			artifactId: "artifact-1",
			format: "html",
			outputPath: "/tmp/session.html",
			sessionId,
			workspaceId,
		});
		expect(new Date(exported.createdAt).toString()).not.toBe("Invalid Date");
	});

	test("uses the export path as artifact id when no tracker is available", async () => {
		const driver = createDriver("/tmp/session.jsonl");
		const record = createRecord();

		const exported = await exportReadySession(driver, undefined, record, "jsonl", undefined);

		expect(driver.exportSession).toHaveBeenCalledWith(record.handle, { format: "jsonl" });
		expect(exported).toMatchObject({
			artifactId: "/tmp/session.jsonl",
			format: "jsonl",
			outputPath: "/tmp/session.jsonl",
		});
	});

	test.each([
		["active run", { activeRunId: "run-1" }],
		["manual compaction", { manualCompactionActive: true }],
		["tree navigation", { treeNavigationActive: true }],
	])("rejects export while %s is active", async (_name, patch) => {
		const driver = createDriver("/tmp/session.html");

		await expect(
			exportReadySession(driver, undefined, createRecord(patch), "html", undefined),
		).rejects.toBeInstanceOf(SessionExportUnavailable);
		expect(driver.exportSession).not.toHaveBeenCalled();
	});
});

function createDriver(outputPath: string): Pick<SessionDriver, "exportSession"> {
	return {
		exportSession: vi.fn(async (_handle, request) => ({
			workspaceId,
			sessionId,
			format: request.format,
			outputPath,
		})),
	};
}

function createRecord(patch: Partial<ManagedSessionRecordForExport> = {}): ManagedSessionRecordForExport {
	return {
		handle: createHandle(),
		manualCompactionActive: false,
		treeNavigationActive: false,
		...patch,
	};
}

function createHandle(): RuntimeSessionHandle {
	return {
		key: `${workspaceId}:${sessionId}`,
		runtime: { dispose: async () => undefined } as RuntimeSessionHandle["runtime"],
		sessionFilePath: "/tmp/session.jsonl",
		sessionId,
		sessionManager: { getEntries: () => [], getSessionId: () => sessionId },
		workspaceId,
		workspacePath: "/tmp/workspace",
	};
}
