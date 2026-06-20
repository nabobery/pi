import { basename } from "node:path";
import type {
	Extension,
	LoadExtensionsResult,
	ResourceDiagnostic,
	Skill,
} from "@earendil-works/pi-coding-agent/runtime";
import type {
	ExtensionResourceSnapshot,
	ResourceDiagnosticSnapshot,
	ResourceInventorySnapshot,
	ResourceSourceInfoSnapshot,
	SessionId,
	SkillResourceSnapshot,
	WorkspaceId,
} from "../../contracts/index.ts";

export interface ResourceInventoryInput {
	extensions: LoadExtensionsResult;
	skills: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
	sessionId?: SessionId;
	updatedAt?: string;
	workspaceId: WorkspaceId;
}

export function projectResourceInventorySnapshot(input: ResourceInventoryInput): ResourceInventorySnapshot {
	return {
		workspaceId: input.workspaceId,
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
		skills: input.skills.skills.map(projectSkill),
		extensions: input.extensions.extensions.map(projectExtension),
		extensionErrors: input.extensions.errors.map((entry) => ({
			id: resourceId("extension-error", entry.path),
			path: entry.path,
			error: entry.error,
		})),
		diagnostics: input.skills.diagnostics.map(projectDiagnostic),
		updatedAt: input.updatedAt ?? new Date().toISOString(),
	};
}

function projectSkill(skill: Skill): SkillResourceSnapshot {
	return {
		id: resourceId("skill", skill.filePath),
		name: skill.name,
		description: skill.description,
		filePath: skill.filePath,
		baseDir: skill.baseDir,
		disableModelInvocation: skill.disableModelInvocation,
		sourceInfo: projectSourceInfo(skill.sourceInfo),
	};
}

function projectExtension(extension: Extension): ExtensionResourceSnapshot {
	return {
		id: resourceId("extension", extension.resolvedPath),
		name: basename(extension.path),
		path: extension.resolvedPath,
		sourceInfo: projectSourceInfo(extension.sourceInfo),
		commands: extension.commands.size,
		tools: extension.tools.size,
		flags: extension.flags.size,
	};
}

function projectSourceInfo(sourceInfo: ResourceSourceInfoSnapshot): ResourceSourceInfoSnapshot {
	return {
		path: sourceInfo.path,
		source: sourceInfo.source,
		scope: sourceInfo.scope,
		origin: sourceInfo.origin,
		...(sourceInfo.baseDir ? { baseDir: sourceInfo.baseDir } : {}),
	};
}

function projectDiagnostic(diagnostic: ResourceDiagnostic): ResourceDiagnosticSnapshot {
	return {
		type: diagnostic.type,
		message: diagnostic.message,
		...(diagnostic.path ? { path: diagnostic.path } : {}),
	};
}

export function resourceId(kind: "extension" | "extension-error" | "skill", path: string): string {
	return `${kind}:${path}`;
}
