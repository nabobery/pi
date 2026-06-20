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
	SettingsEditorReadFailed,
	SettingsSummaryReadFailed,
	SettingsUpdateFailed,
	SettingsUpdateInvalid,
	TrustDecisionInvalid,
	TrustDecisionSaveFailed,
	TrustStatusReadFailed,
	WorkspaceNotFound,
	type CommonSettingsPatch,
	type SettingsEditorSnapshot,
	type SettingsFieldSnapshot,
	type SettingsSummarySnapshot,
	type SettingsValueSnapshot,
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
			const { agentDir, settingsManager, workspacePath } = await this.createSettingsManager(workspaceId);
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
				imageAutoResize: settingsManager.getImageAutoResize(),
				imageBlockImages: settingsManager.getBlockImages(),
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

	async getImageSettings(workspaceId: WorkspaceId): Promise<{ autoResize: boolean; blockImages: boolean }> {
		const { settingsManager } = await this.createSettingsManager(workspaceId);
		return {
			autoResize: settingsManager.getImageAutoResize(),
			blockImages: settingsManager.getBlockImages(),
		};
	}

	async getEditorSnapshot(workspaceId: WorkspaceId): Promise<SettingsEditorSnapshot> {
		try {
			const { agentDir, settingsManager, workspacePath } = await this.createSettingsManager(workspaceId);
			return this.projectEditorSnapshot(workspaceId, agentDir, workspacePath, settingsManager);
		} catch (error) {
			throw new SettingsEditorReadFailed({
				workspaceId,
				message: "Failed to read Pi settings editor snapshot",
				cause: getErrorMessage(error),
			});
		}
	}

	async updateCommonSettings(workspaceId: WorkspaceId, patch: CommonSettingsPatch): Promise<SettingsEditorSnapshot> {
		try {
			const { agentDir, settingsManager, workspacePath } = await this.createSettingsManager(workspaceId);
			this.applyCommonSettingsPatch(workspaceId, settingsManager, patch);
			await settingsManager.flush();
			const writeErrors = settingsManager.drainErrors();
			if (writeErrors.length > 0) {
				throw new Error(writeErrors.map((entry) => `${entry.scope}: ${entry.error.message}`).join("; "));
			}
			await settingsManager.reload();
			return this.projectEditorSnapshot(workspaceId, agentDir, workspacePath, settingsManager);
		} catch (error) {
			if (error instanceof SettingsUpdateInvalid) throw error;
			throw new SettingsUpdateFailed({
				workspaceId,
				message: "Failed to update Pi settings",
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
				options: getProjectTrustOptions(cwd).map((option, index) => ({
					id: trustOptionId(option.label, index),
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

	async saveTrustDecision(workspaceId: WorkspaceId, optionId: string): Promise<TrustStatusSnapshot> {
		const cwd = await this.getWorkspacePath(workspaceId);
		const options = getProjectTrustOptions(cwd);
		const option = options.find((candidate, index) => trustOptionId(candidate.label, index) === optionId);
		if (!option) {
			throw new TrustDecisionInvalid({
				workspaceId,
				optionId,
				message: "Trust decision option is not available",
			});
		}
		try {
			new ProjectTrustStore(this.resolveAgentDir()).setMany(option.updates);
			return this.getTrustStatus(workspaceId);
		} catch (error) {
			throw new TrustDecisionSaveFailed({
				workspaceId,
				optionId,
				message: "Failed to save Pi project trust decision",
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

	private async createSettingsManager(workspaceId: WorkspaceId): Promise<{
		agentDir: string;
		settingsManager: SettingsManager;
		workspacePath: string;
	}> {
		const workspacePath = await this.getWorkspacePath(workspaceId);
		const agentDir = this.resolveAgentDir();
		const projectTrusted = this.resolveProjectTrusted(agentDir, workspacePath);
		const settingsManager = SettingsManager.create(workspacePath, agentDir, { projectTrusted });
		return { agentDir, settingsManager, workspacePath };
	}

	private projectEditorSnapshot(
		workspaceId: WorkspaceId,
		agentDir: string,
		workspacePath: string,
		settingsManager: SettingsManager,
	): SettingsEditorSnapshot {
		const globalSettings = settingsManager.getGlobalSettings();
		const projectSettings = settingsManager.getProjectSettings();
		const diagnostics = settingsManager.drainErrors().map((entry) => ({
			message: entry.error.message,
			path: entry.scope,
		}));
		return {
			workspaceId,
			globalSettingsPath: this.globalSettingsPath(agentDir),
			projectSettingsPath: this.projectSettingsPath(workspacePath),
			fields: [
				settingField(
					"defaultProvider",
					"Default provider",
					settingsManager.getDefaultProvider(),
					globalSettings.defaultProvider,
					projectSettings.defaultProvider,
				),
				settingField(
					"defaultModel",
					"Default model",
					settingsManager.getDefaultModel(),
					globalSettings.defaultModel,
					projectSettings.defaultModel,
				),
				settingField(
					"defaultThinkingLevel",
					"Default thinking",
					settingsManager.getDefaultThinkingLevel(),
					globalSettings.defaultThinkingLevel,
					projectSettings.defaultThinkingLevel,
				),
				settingField(
					"enabledModels",
					"Enabled models",
					settingsManager.getEnabledModels(),
					globalSettings.enabledModels,
					projectSettings.enabledModels,
				),
				settingField(
					"enableSkillCommands",
					"Skill commands",
					settingsManager.getEnableSkillCommands(),
					globalSettings.enableSkillCommands,
					projectSettings.enableSkillCommands,
				),
				settingField(
					"steeringMode",
					"Steering mode",
					settingsManager.getSteeringMode(),
					globalSettings.steeringMode,
					projectSettings.steeringMode,
				),
				settingField(
					"followUpMode",
					"Follow-up mode",
					settingsManager.getFollowUpMode(),
					globalSettings.followUpMode,
					projectSettings.followUpMode,
				),
				settingField(
					"defaultProjectTrust",
					"Default project trust",
					settingsManager.getDefaultProjectTrust(),
					globalSettings.defaultProjectTrust,
					projectSettings.defaultProjectTrust,
				),
				settingField(
					"compactionEnabled",
					"Compaction",
					settingsManager.getCompactionEnabled(),
					globalSettings.compaction?.enabled,
					projectSettings.compaction?.enabled,
				),
				settingField(
					"imageAutoResize",
					"Image auto-resize",
					settingsManager.getImageAutoResize(),
					globalSettings.images?.autoResize,
					projectSettings.images?.autoResize,
				),
				settingField(
					"imageBlockImages",
					"Block images",
					settingsManager.getBlockImages(),
					globalSettings.images?.blockImages,
					projectSettings.images?.blockImages,
				),
			],
			updatedAt: new Date().toISOString(),
			settingsDiagnostics: diagnostics,
		};
	}

	private applyCommonSettingsPatch(
		workspaceId: WorkspaceId,
		settingsManager: SettingsManager,
		patch: CommonSettingsPatch,
	): void {
		if (Object.keys(patch).length === 0) {
			throw new SettingsUpdateInvalid({
				workspaceId,
				message: "Settings update patch is empty",
			});
		}
		if (patch.defaultProvider && patch.defaultModel) {
			settingsManager.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
		} else {
			if (patch.defaultProvider) settingsManager.setDefaultProvider(patch.defaultProvider);
			if (patch.defaultModel) settingsManager.setDefaultModel(patch.defaultModel);
		}
		if (patch.defaultThinkingLevel) settingsManager.setDefaultThinkingLevel(patch.defaultThinkingLevel);
		if (patch.enabledModels) {
			settingsManager.setEnabledModels(patch.enabledModels.length > 0 ? [...patch.enabledModels] : undefined);
		}
		if (patch.enableSkillCommands !== undefined) settingsManager.setEnableSkillCommands(patch.enableSkillCommands);
		if (patch.steeringMode) settingsManager.setSteeringMode(patch.steeringMode);
		if (patch.followUpMode) settingsManager.setFollowUpMode(patch.followUpMode);
		if (patch.defaultProjectTrust) settingsManager.setDefaultProjectTrust(patch.defaultProjectTrust);
		if (patch.compactionEnabled !== undefined) settingsManager.setCompactionEnabled(patch.compactionEnabled);
		if (patch.imageAutoResize !== undefined) settingsManager.setImageAutoResize(patch.imageAutoResize);
		if (patch.imageBlockImages !== undefined) settingsManager.setBlockImages(patch.imageBlockImages);
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

function settingField(
	key: string,
	label: string,
	effectiveValue: SettingsValueSnapshot | undefined,
	globalValue: SettingsValueSnapshot | undefined,
	projectValue: SettingsValueSnapshot | undefined,
): SettingsFieldSnapshot {
	return {
		key,
		label,
		source: projectValue !== undefined ? "project" : globalValue !== undefined ? "global" : "default",
		effectiveValue: effectiveValue ?? null,
		...(globalValue !== undefined ? { globalValue } : {}),
		...(projectValue !== undefined ? { projectValue } : {}),
	};
}

function trustOptionId(label: string, index: number): string {
	return `${index}:${
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "trust"
	}`;
}
