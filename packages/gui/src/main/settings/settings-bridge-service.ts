import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	ProjectTrustStore,
	SettingsManager,
	getAgentDir,
	getProjectTrustOptions,
	hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	SettingsFileOpenFailed,
	SettingsFileUnavailable,
	SettingsSummaryReadFailed,
	TrustStatusReadFailed,
	WorkspaceNotFound,
	type SettingsSummarySnapshot,
	type TrustStatusSnapshot,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";

export interface SettingsBridgeCatalogService {
	getWorkspaceCatalog(): Promise<WorkspaceCatalogSnapshot>;
}

export interface SettingsShellAdapter {
	openPath(path: string): Promise<string>;
	showItemInFolder(path: string): void;
}

export interface SettingsBridgeServiceOptions {
	catalogService: SettingsBridgeCatalogService;
	getAgentDir?: () => string;
	shell?: SettingsShellAdapter;
}

export class SettingsBridgeService {
	private readonly catalogService: SettingsBridgeCatalogService;
	private readonly resolveAgentDir: () => string;
	private readonly shell: SettingsShellAdapter | undefined;

	constructor(options: SettingsBridgeServiceOptions) {
		this.catalogService = options.catalogService;
		this.resolveAgentDir = options.getAgentDir ?? getAgentDir;
		this.shell = options.shell;
	}

	async getSummary(workspaceId: WorkspaceId): Promise<SettingsSummarySnapshot> {
		try {
			const workspacePath = await this.getWorkspacePath(workspaceId);
			const agentDir = this.resolveAgentDir();
			const projectTrusted = this.resolveProjectTrusted(agentDir, workspacePath);
			const settingsManager = SettingsManager.create(workspacePath, agentDir, { projectTrusted });
			const diagnostics = settingsManager.drainErrors().map((entry) => ({
				message: entry.error.message,
				path: entry.scope,
			}));
			return {
				workspaceId,
				globalSettingsPath: this.globalSettingsPath(agentDir),
				projectSettingsPath: this.projectSettingsPath(workspacePath),
				...(settingsManager.getDefaultProvider() ? { defaultProvider: settingsManager.getDefaultProvider() } : {}),
				...(settingsManager.getDefaultModel() ? { defaultModel: settingsManager.getDefaultModel() } : {}),
				...(settingsManager.getDefaultThinkingLevel()
					? { defaultThinkingLevel: settingsManager.getDefaultThinkingLevel() }
					: {}),
				enableSkillCommands: settingsManager.getEnableSkillCommands(),
				steeringMode: settingsManager.getSteeringMode(),
				followUpMode: settingsManager.getFollowUpMode(),
				defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
				settingsDiagnostics: diagnostics,
			};
		} catch (error) {
			throw new SettingsSummaryReadFailed({
				workspaceId,
				message: "Failed to read Pi settings summary",
				cause: getErrorMessage(error),
			});
		}
	}

	async getTrustStatus(workspaceId: WorkspaceId): Promise<TrustStatusSnapshot> {
		try {
			const cwd = await this.getWorkspacePath(workspaceId);
			const agentDir = this.resolveAgentDir();
			const trustStore = new ProjectTrustStore(agentDir);
			const entry = trustStore.getEntry(cwd);
			const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: entry?.decision === true });
			const defaultTrust = settingsManager.getDefaultProjectTrust();
			const trusted = entry?.decision ?? defaultTrust === "always";
			return {
				workspaceId,
				cwd,
				trusted,
				source: entry ? "saved" : defaultTrust === "ask" ? "unknown" : "default",
				...(entry?.path ? { savedPath: entry.path } : {}),
				requiresTrust: hasTrustRequiringProjectResources(cwd),
				options: getProjectTrustOptions(cwd).map((option) => ({
					label: option.label,
					trusted: option.trusted,
					updates: option.updates.map((update) => ({ path: update.path, decision: update.decision })),
				})),
			};
		} catch (error) {
			throw new TrustStatusReadFailed({
				workspaceId,
				message: "Failed to read Pi trust status",
				cause: getErrorMessage(error),
			});
		}
	}

	async openSettingsFile(workspaceId: WorkspaceId, scope: "global" | "project"): Promise<void> {
		const path = await this.getSettingsPath(workspaceId, scope);
		this.assertSettingsFileAvailable(workspaceId, scope, path);
		try {
			const error = await this.getShell(workspaceId, scope, path).openPath(path);
			if (error) throw new Error(error);
		} catch (error) {
			throw new SettingsFileOpenFailed({
				workspaceId,
				scope,
				path,
				message: "Failed to open Pi settings file",
				cause: getErrorMessage(error),
			});
		}
	}

	async revealSettingsFile(workspaceId: WorkspaceId, scope: "global" | "project"): Promise<void> {
		const path = await this.getSettingsPath(workspaceId, scope);
		this.assertSettingsFileAvailable(workspaceId, scope, path);
		try {
			this.getShell(workspaceId, scope, path).showItemInFolder(path);
		} catch (error) {
			throw new SettingsFileOpenFailed({
				workspaceId,
				scope,
				path,
				message: "Failed to reveal Pi settings file",
				cause: getErrorMessage(error),
			});
		}
	}

	private getShell(workspaceId: WorkspaceId, scope: "global" | "project", path: string): SettingsShellAdapter {
		if (this.shell) return this.shell;
		throw new SettingsFileOpenFailed({
			workspaceId,
			scope,
			path,
			message: "Pi settings shell adapter is not available",
		});
	}

	private async getWorkspacePath(workspaceId: WorkspaceId): Promise<string> {
		const catalog = await this.catalogService.getWorkspaceCatalog();
		const workspace = catalog.workspaces.find((entry) => entry.id === workspaceId);
		if (workspace) return workspace.path;
		throw new WorkspaceNotFound({
			workspaceId,
			message: `Workspace ${workspaceId} is not in the GUI catalog`,
		});
	}

	private resolveProjectTrusted(agentDir: string, workspacePath: string): boolean {
		const entry = new ProjectTrustStore(agentDir).getEntry(workspacePath);
		if (entry?.decision !== null && entry?.decision !== undefined) return entry.decision;
		const settingsManager = SettingsManager.create(workspacePath, agentDir, { projectTrusted: false });
		return settingsManager.getDefaultProjectTrust() === "always";
	}

	private async getSettingsPath(workspaceId: WorkspaceId, scope: "global" | "project"): Promise<string> {
		const agentDir = this.resolveAgentDir();
		if (scope === "global") return this.globalSettingsPath(agentDir);
		return this.projectSettingsPath(await this.getWorkspacePath(workspaceId));
	}

	private globalSettingsPath(agentDir: string): string {
		return join(agentDir, "settings.json");
	}

	private projectSettingsPath(workspacePath: string): string {
		return join(workspacePath, ".pi", "settings.json");
	}

	private assertSettingsFileAvailable(workspaceId: WorkspaceId, scope: "global" | "project", path: string): void {
		if (existsSync(path)) return;
		throw new SettingsFileUnavailable({
			workspaceId,
			scope,
			path,
			message: `Pi ${scope} settings file does not exist`,
		});
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
