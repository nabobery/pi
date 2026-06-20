import { randomUUID } from "node:crypto";
import { ArtifactNotFound, ArtifactOpenFailed, isAllowedExternalArtifactUrl } from "../../contracts/index.ts";

export interface ArtifactShellAdapter {
	openExternal(url: string): Promise<void>;
	openPath(path: string): Promise<string>;
	showItemInFolder(path: string): void;
}

interface FileArtifact {
	id: string;
	kind: "file";
	path: string;
}

interface ExternalArtifact {
	id: string;
	kind: "external";
	url: string;
}

type Artifact = FileArtifact | ExternalArtifact;

export class ArtifactService {
	private readonly artifacts = new Map<string, Artifact>();
	private readonly shell: ArtifactShellAdapter;

	constructor(options: { shell: ArtifactShellAdapter }) {
		this.shell = options.shell;
	}

	trackFile(path: string): string {
		const id = `artifact-${randomUUID()}`;
		this.artifacts.set(id, { id, kind: "file", path });
		return id;
	}

	trackExternal(url: string): string {
		if (!isAllowedExternalArtifactUrl(url)) {
			throw new ArtifactOpenFailed({ artifactId: "untracked", message: "External artifact URL is not allowed" });
		}
		const id = `artifact-${randomUUID()}`;
		this.artifacts.set(id, { id, kind: "external", url });
		return id;
	}

	async open(artifactId: string): Promise<void> {
		const artifact = this.requireArtifact(artifactId);
		if (artifact.kind !== "file") {
			throw new ArtifactOpenFailed({ artifactId, message: "Artifact is not a file" });
		}
		try {
			const error = await this.shell.openPath(artifact.path);
			if (error) throw new Error(error);
		} catch (error) {
			throw new ArtifactOpenFailed({
				artifactId,
				message: "Failed to open artifact",
				cause: getErrorMessage(error),
			});
		}
	}

	reveal(artifactId: string): void {
		const artifact = this.requireArtifact(artifactId);
		if (artifact.kind !== "file") {
			throw new ArtifactOpenFailed({ artifactId, message: "Artifact is not a file" });
		}
		try {
			this.shell.showItemInFolder(artifact.path);
		} catch (error) {
			throw new ArtifactOpenFailed({
				artifactId,
				message: "Failed to reveal artifact",
				cause: getErrorMessage(error),
			});
		}
	}

	async openExternal(artifactId: string): Promise<void> {
		const artifact = this.requireArtifact(artifactId);
		if (artifact.kind !== "external") {
			throw new ArtifactOpenFailed({ artifactId, message: "Artifact is not an external URL" });
		}
		try {
			await this.shell.openExternal(artifact.url);
		} catch (error) {
			throw new ArtifactOpenFailed({
				artifactId,
				message: "Failed to open external artifact",
				cause: getErrorMessage(error),
			});
		}
	}

	private requireArtifact(artifactId: string): Artifact {
		const artifact = this.artifacts.get(artifactId);
		if (artifact) return artifact;
		throw new ArtifactNotFound({ artifactId, message: "Artifact is not available" });
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
