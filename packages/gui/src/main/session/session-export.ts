import { SessionExportUnavailable, type SessionExportSnapshot } from "../../contracts/index.ts";
import type { RuntimeSessionHandle, SessionDriver } from "./session-driver.ts";

export interface SessionArtifactTracker {
	trackFile(path: string): string;
}

export interface ManagedSessionRecordForExport {
	activeRunId?: string;
	handle: RuntimeSessionHandle;
	manualCompactionActive: boolean;
	treeNavigationActive: boolean;
}

export async function exportReadySession(
	driver: Pick<SessionDriver, "exportSession">,
	artifactTracker: SessionArtifactTracker | undefined,
	record: ManagedSessionRecordForExport,
	format: "html" | "jsonl",
	outputPath: string | undefined,
): Promise<SessionExportSnapshot> {
	if (record.activeRunId || record.manualCompactionActive || record.treeNavigationActive) {
		throw new SessionExportUnavailable({
			workspaceId: record.handle.workspaceId,
			sessionId: record.handle.sessionId,
			message: "Session export is unavailable while the Pi session is busy",
		});
	}
	const exported = await driver.exportSession(record.handle, {
		format,
		...(outputPath ? { outputPath } : {}),
	});
	return {
		...exported,
		artifactId: artifactTracker?.trackFile(exported.outputPath) ?? exported.outputPath,
		createdAt: new Date().toISOString(),
	};
}
