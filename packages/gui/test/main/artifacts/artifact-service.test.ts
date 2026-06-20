import { describe, expect, test, vi } from "vitest";
import { ArtifactNotFound, ArtifactOpenFailed } from "../../../src/contracts/index.ts";
import { ArtifactService, type ArtifactShellAdapter } from "../../../src/main/artifacts/artifact-service.ts";

describe("ArtifactService", () => {
	test("opens and reveals tracked file artifacts", async () => {
		const shell = createShell();
		const service = new ArtifactService({ shell });
		const artifactId = service.trackFile("/tmp/session.html");

		await service.open(artifactId);
		service.reveal(artifactId);

		expect(shell.openPath).toHaveBeenCalledWith("/tmp/session.html");
		expect(shell.showItemInFolder).toHaveBeenCalledWith("/tmp/session.html");
	});

	test("opens only tracked and validated external artifacts", async () => {
		const shell = createShell();
		const service = new ArtifactService({ shell });
		const artifactId = service.trackExternal("https://pi.dev/session/#abc123");

		await service.openExternal(artifactId);

		expect(shell.openExternal).toHaveBeenCalledWith("https://pi.dev/session/#abc123");
		expect(() => service.trackExternal("javascript:alert(1)")).toThrow(ArtifactOpenFailed);
	});

	test("rejects missing artifacts and wrong artifact kinds", async () => {
		const service = new ArtifactService({ shell: createShell() });
		const fileArtifactId = service.trackFile("/tmp/session.html");
		const externalArtifactId = service.trackExternal("https://pi.dev/session/#abc123");

		await expect(service.open("missing")).rejects.toBeInstanceOf(ArtifactNotFound);
		await expect(service.openExternal(fileArtifactId)).rejects.toBeInstanceOf(ArtifactOpenFailed);
		await expect(service.open(externalArtifactId)).rejects.toBeInstanceOf(ArtifactOpenFailed);
	});

	test("wraps shell failures as artifact open failures", async () => {
		const shell = createShell();
		shell.openPath.mockResolvedValue("open failed");
		const service = new ArtifactService({ shell });
		const artifactId = service.trackFile("/tmp/session.html");

		await expect(service.open(artifactId)).rejects.toBeInstanceOf(ArtifactOpenFailed);
	});
});

function createShell(): {
	openExternal: ReturnType<typeof vi.fn<ArtifactShellAdapter["openExternal"]>>;
	openPath: ReturnType<typeof vi.fn<ArtifactShellAdapter["openPath"]>>;
	showItemInFolder: ReturnType<typeof vi.fn<ArtifactShellAdapter["showItemInFolder"]>>;
} {
	return {
		openExternal: vi.fn(async () => undefined),
		openPath: vi.fn(async () => ""),
		showItemInFolder: vi.fn(() => undefined),
	};
}
