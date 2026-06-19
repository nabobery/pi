import { homedir } from "node:os";
import { join } from "node:path";

export function getAgentDir(): string {
	return join(process.env.HOME ?? homedir(), ".pi");
}

export class ProjectTrustStore {
	getEntry(): undefined {
		return undefined;
	}
}

export class SettingsManager {
	static create(): SettingsManager {
		return new SettingsManager();
	}

	drainErrors(): Array<{ error: Error; scope: string }> {
		return [];
	}

	getDefaultProvider(): string | undefined {
		return undefined;
	}

	getDefaultModel(): string | undefined {
		return undefined;
	}

	getDefaultThinkingLevel(): string | undefined {
		return undefined;
	}

	getEnableSkillCommands(): boolean {
		return true;
	}

	getSteeringMode(): "all" {
		return "all";
	}

	getFollowUpMode(): "all" {
		return "all";
	}

	getDefaultProjectTrust(): "ask" {
		return "ask";
	}
}

export const SessionManager = {
	open(): never {
		throw new Error("Pi SDK SessionManager is unavailable in GUI E2E fake-runtime builds");
	},
};

export function getProjectTrustOptions(): [] {
	return [];
}

export function hasTrustRequiringProjectResources(): boolean {
	return false;
}

export function getSupportedThinkingLevels(): ["off"] {
	return ["off"];
}

export function createAgentSessionRuntime(): never {
	throw new Error("Pi SDK runtime is unavailable in GUI E2E fake-runtime builds");
}

export function createAgentSessionServices(): never {
	throw new Error("Pi SDK services are unavailable in GUI E2E fake-runtime builds");
}

export function createAgentSessionFromServices(): never {
	throw new Error("Pi SDK session is unavailable in GUI E2E fake-runtime builds");
}
