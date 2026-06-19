import { BUILTIN_SLASH_COMMANDS } from "@earendil-works/pi-coding-agent/runtime";
import type {
	SessionId,
	SlashCommandCatalogSnapshot,
	SlashCommandSnapshot,
	WorkspaceId,
} from "../../contracts/index.ts";
import { SlashCommandCatalogUnavailable as SlashCommandCatalogUnavailableError } from "../../contracts/index.ts";
import type { SessionSupervisor } from "./session-supervisor.ts";

export interface SlashCommandServiceOptions {
	now?: () => Date;
	sessionSupervisor: Pick<SessionSupervisor, "getSlashCommands">;
}

const GUI_ACTION_COMMANDS = new Set(["resume", "new", "settings", "trust", "model", "name", "tree", "compact"]);

export class SlashCommandService {
	private readonly now: () => Date;
	private readonly sessionSupervisor: Pick<SessionSupervisor, "getSlashCommands">;

	constructor(options: SlashCommandServiceOptions) {
		this.now = options.now ?? (() => new Date());
		this.sessionSupervisor = options.sessionSupervisor;
	}

	async getCatalog(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SlashCommandCatalogSnapshot> {
		let dynamicCommands: SlashCommandSnapshot[];
		try {
			dynamicCommands = await this.sessionSupervisor.getSlashCommands(workspaceId, sessionId);
		} catch (error) {
			throw new SlashCommandCatalogUnavailableError({
				workspaceId,
				sessionId,
				message: "Slash command catalog is unavailable for this session",
				cause: getErrorMessage(error),
			});
		}
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		const commands: SlashCommandSnapshot[] = [];
		for (const command of BUILTIN_SLASH_COMMANDS) {
			const isGuiAction = GUI_ACTION_COMMANDS.has(command.name);
			commands.push({
				name: command.name,
				description: command.description,
				source: "builtin",
				availability: isGuiAction ? "guiAction" : "deferred",
				...(isGuiAction
					? {}
					: { disabledReason: "This Pi built-in command is not implemented in the desktop host yet." }),
			});
		}
		for (const command of dynamicCommands) {
			if (builtinNames.has(command.name)) {
				commands.push({
					name: command.name,
					...(command.description ? { description: command.description } : {}),
					source: command.source,
					...(command.sourceInfo ? { sourceInfo: command.sourceInfo } : {}),
					availability: "conflict",
					disabledReason: "Conflicts with a built-in Pi command.",
				});
				continue;
			}
			commands.push(command);
		}
		return {
			workspaceId,
			sessionId,
			commands: commands.sort(sortCommands),
			updatedAt: this.now().toISOString(),
		};
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function sortCommands(left: SlashCommandSnapshot, right: SlashCommandSnapshot): number {
	const sourceOrder = sourceRank(left.source) - sourceRank(right.source);
	if (sourceOrder !== 0) return sourceOrder;
	return left.name.localeCompare(right.name);
}

function sourceRank(source: SlashCommandSnapshot["source"]): number {
	if (source === "builtin") return 0;
	if (source === "extension") return 1;
	if (source === "prompt") return 2;
	return 3;
}
