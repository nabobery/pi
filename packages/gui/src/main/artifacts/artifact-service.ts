import { randomUUID } from "node:crypto";
import { ArtifactNotFound, ArtifactOpenFailed } from "../../contracts/index.ts";
import { createExternalArtifactUrlPolicy, type ExternalArtifactUrlPolicy } from "./artifact-url-policy.ts";

export interface ArtifactShellAdapter {
	openExternal(url: string): Promise<void>;
	openPath(path: string): Promise<string>;
	showItemInFolder(path: string): void;
}

export interface ArtifactServiceOptions {
	isAllowedExternalUrl?: ExternalArtifactUrlPolicy;
	shell: ArtifactShellAdapter;
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
	private readonly isAllowedExternalUrl: ExternalArtifactUrlPolicy;
	private readonly shell: ArtifactShellAdapter;

	constructor(options: ArtifactServiceOptions) {
		this.isAllowedExternalUrl = options.isAllowedExternalUrl ?? createExternalArtifactUrlPolicy();
		this.shell = options.shell;
	}

	trackFile(path: string): string {
		const id = `artifact-${randomUUID()}`;
		this.artifacts.set(id, { id, kind: "file", path });
		return id;
	}

	trackExternal(url: string): string {
		if (!this.isAllowedExternalUrl(url)) {
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
