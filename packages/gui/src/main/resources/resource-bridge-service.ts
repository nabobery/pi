import { existsSync } from "node:fs";
import {
	ProjectTrustStore,
	SettingsManager,
	createAgentSessionServices,
	getAgentDir,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	ResourceInventoryReadFailed,
	ResourceReloadFailed,
	ResourceSourceOpenFailed,
	ResourceSourceUnavailable,
	WorkspaceNotFound,
	type ResourceInventorySnapshot,
	type SessionId,
	type WorkspaceCatalogSnapshot,
	type WorkspaceId,
} from "../../contracts/index.ts";
import type { SettingsShellAdapter } from "../settings/settings-bridge-service.ts";
import { projectResourceInventorySnapshot } from "../session/resource-inventory-projection.ts";

export interface ResourceBridgeCatalogService {
	getWorkspaceCatalog(): Promise<WorkspaceCatalogSnapshot>;
}

export interface ResourceBridgeSessionSupervisor {
	getResourceInventory?(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ResourceInventorySnapshot>;
	reloadResources?(workspaceId: WorkspaceId, sessionId: SessionId): Promise<ResourceInventorySnapshot>;
	reloadWorkspaceResources?(workspaceId: WorkspaceId): Promise<ResourceInventorySnapshot[]>;
}

export interface ResourceBridgeServiceOptions {
	catalogService: ResourceBridgeCatalogService;
	getAgentDir?: () => string;
	sessionSupervisor?: ResourceBridgeSessionSupervisor;
	shell?: SettingsShellAdapter;
}

export class ResourceBridgeService {
	private readonly catalogService: ResourceBridgeCatalogService;
	private readonly resolveAgentDir: () => string;
	private readonly sessionSupervisor: ResourceBridgeSessionSupervisor | undefined;
	private readonly shell: SettingsShellAdapter | undefined;

	constructor(options: ResourceBridgeServiceOptions) {
		this.catalogService = options.catalogService;
		this.resolveAgentDir = options.getAgentDir ?? getAgentDir;
		this.sessionSupervisor = options.sessionSupervisor;
		this.shell = options.shell;
	}

	async getInventory(workspaceId: WorkspaceId, sessionId: SessionId | undefined): Promise<ResourceInventorySnapshot> {
		if (sessionId && this.sessionSupervisor?.getResourceInventory) {
			return this.sessionSupervisor.getResourceInventory(workspaceId, sessionId);
		}
		return this.loadWorkspaceInventory(workspaceId);
	}

	async reload(workspaceId: WorkspaceId, sessionId: SessionId | undefined): Promise<ResourceInventorySnapshot> {
		if (sessionId && this.sessionSupervisor?.reloadResources) {
			return this.sessionSupervisor.reloadResources(workspaceId, sessionId);
		}
		if (!sessionId && this.sessionSupervisor?.reloadWorkspaceResources) {
			const inventories = await this.sessionSupervisor.reloadWorkspaceResources(workspaceId);
			if (inventories.length > 0) return inventories.at(-1) as ResourceInventorySnapshot;
		}
		try {
			return await this.loadWorkspaceInventory(workspaceId);
		} catch (error) {
			if (error instanceof ResourceInventoryReadFailed) {
				throw new ResourceReloadFailed({
					workspaceId,
					...(sessionId ? { sessionId } : {}),
					message: "Failed to reload Pi workspace resources",
					cause: error.cause,
				});
			}
			throw error;
		}
	}

	async openSource(workspaceId: WorkspaceId, resourceId: string): Promise<void> {
		const path = await this.resolveResourcePath(workspaceId, resourceId);
		try {
			const error = await this.getShell(workspaceId, resourceId, path).openPath(path);
			if (error) throw new Error(error);
		} catch (error) {
			throw new ResourceSourceOpenFailed({
				workspaceId,
				resourceId,
				path,
				message: "Failed to open Pi resource source",
				cause: getErrorMessage(error),
			});
		}
	}

	async revealSource(workspaceId: WorkspaceId, resourceId: string): Promise<void> {
		const path = await this.resolveResourcePath(workspaceId, resourceId);
		try {
			this.getShell(workspaceId, resourceId, path).showItemInFolder(path);
		} catch (error) {
			throw new ResourceSourceOpenFailed({
				workspaceId,
				resourceId,
				path,
				message: "Failed to reveal Pi resource source",
				cause: getErrorMessage(error),
			});
		}
	}

	private async loadWorkspaceInventory(workspaceId: WorkspaceId): Promise<ResourceInventorySnapshot> {
		try {
			const workspacePath = await this.getWorkspacePath(workspaceId);
			const agentDir = this.resolveAgentDir();
			const settingsManager = SettingsManager.create(workspacePath, agentDir, {
				projectTrusted: this.resolveProjectTrusted(agentDir, workspacePath),
			});
			const services = await createAgentSessionServices({
				cwd: workspacePath,
				agentDir,
				settingsManager,
			});
			return projectResourceInventorySnapshot({
				workspaceId,
				extensions: services.resourceLoader.getExtensions(),
				skills: services.resourceLoader.getSkills(),
			});
		} catch (error) {
			if (error instanceof WorkspaceNotFound) throw error;
			throw new ResourceInventoryReadFailed({
				workspaceId,
				message: "Failed to read Pi workspace resources",
				cause: getErrorMessage(error),
			});
		}
	}

	private async resolveResourcePath(workspaceId: WorkspaceId, resourceId: string): Promise<string> {
		const inventory = await this.loadWorkspaceInventory(workspaceId);
		const skill = inventory.skills.find((entry) => entry.id === resourceId);
		const extension = inventory.extensions.find((entry) => entry.id === resourceId);
		const extensionError = inventory.extensionErrors.find((entry) => entry.id === resourceId);
		const path = skill?.filePath ?? extension?.path ?? extensionError?.path;
		if (path && existsSync(path)) return path;
		throw new ResourceSourceUnavailable({
			workspaceId,
			resourceId,
			message: "Pi resource source is not available",
		});
	}

	private getShell(workspaceId: WorkspaceId, resourceId: string, path: string): SettingsShellAdapter {
		if (this.shell) return this.shell;
		throw new ResourceSourceOpenFailed({
			workspaceId,
			resourceId,
			path,
			message: "Pi resource shell adapter is not available",
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
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
