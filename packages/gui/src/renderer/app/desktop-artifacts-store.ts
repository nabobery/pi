import {
	ArtifactOpen,
	ArtifactOpenExternal,
	ArtifactReveal,
	ComposerClearImageAttachments,
	ComposerPasteImageFromClipboard,
	ComposerPickImages,
	ComposerRemoveImageAttachment,
	SessionExport,
	SessionShare,
	type GuiCommand,
	type RequestId,
	type SessionId,
	type WorkspaceId,
} from "../../contracts/index.ts";
import type { CatalogViewState } from "./app-store.ts";
import { sessionKey } from "./session-state-projections.ts";

export interface SessionArtifactOperationState {
	error: string | undefined;
	exporting: boolean;
	sharing: boolean;
}

export interface DesktopArtifactStoreActions {
	clearImageAttachments(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	exportSession(workspaceId: WorkspaceId, sessionId: SessionId, format: "html" | "jsonl"): Promise<void>;
	openArtifact(artifactId: string): Promise<void>;
	openExternalArtifact(artifactId: string): Promise<void>;
	pasteImageFromClipboard(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	pickImages(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
	removeImageAttachment(workspaceId: WorkspaceId, sessionId: SessionId, attachmentId: string): Promise<void>;
	revealArtifact(artifactId: string): Promise<void>;
	shareSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<void>;
}

export interface DesktopArtifactStoreActionsContext {
	getState(): CatalogViewState;
	invoke(command: GuiCommand): Promise<boolean>;
	invokeVoid(command: GuiCommand): Promise<void>;
	nextRequestId(prefix: string): RequestId;
	updateState(update: (current: CatalogViewState) => CatalogViewState): void;
}

export function createDesktopArtifactStoreActions(
	context: DesktopArtifactStoreActionsContext,
): DesktopArtifactStoreActions {
	function updateArtifactState(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		patch: Partial<SessionArtifactOperationState>,
	): void {
		context.updateState((current) => {
			const key = sessionKey(workspaceId, sessionId);
			const previous = current.sessionArtifactStateBySessionKey[key] ?? emptySessionArtifactOperationState();
			return {
				...current,
				sessionArtifactStateBySessionKey: {
					...current.sessionArtifactStateBySessionKey,
					[key]: { ...previous, ...patch },
				},
			};
		});
	}

	async function invokeArtifactCommand(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		command: GuiCommand,
		pendingKey: "exporting" | "sharing",
	): Promise<void> {
		updateArtifactState(workspaceId, sessionId, { [pendingKey]: true, error: undefined });
		const ok = await context.invoke(command);
		const error = ok ? undefined : context.getState().error;
		updateArtifactState(workspaceId, sessionId, { [pendingKey]: false, error });
	}

	return {
		pickImages: (workspaceId, sessionId) =>
			context.invokeVoid(
				new ComposerPickImages({
					requestId: context.nextRequestId("composer.pickImages"),
					workspaceId,
					sessionId,
				}),
			),
		pasteImageFromClipboard: (workspaceId, sessionId) =>
			context.invokeVoid(
				new ComposerPasteImageFromClipboard({
					requestId: context.nextRequestId("composer.pasteImageFromClipboard"),
					workspaceId,
					sessionId,
				}),
			),
		removeImageAttachment: (workspaceId, sessionId, attachmentId) =>
			context.invokeVoid(
				new ComposerRemoveImageAttachment({
					requestId: context.nextRequestId("composer.removeImageAttachment"),
					workspaceId,
					sessionId,
					attachmentId,
				}),
			),
		clearImageAttachments: (workspaceId, sessionId) =>
			context.invokeVoid(
				new ComposerClearImageAttachments({
					requestId: context.nextRequestId("composer.clearImageAttachments"),
					workspaceId,
					sessionId,
				}),
			),
		exportSession: (workspaceId, sessionId, format) =>
			invokeArtifactCommand(
				workspaceId,
				sessionId,
				new SessionExport({
					requestId: context.nextRequestId("session.export"),
					workspaceId,
					sessionId,
					format,
				}),
				"exporting",
			),
		shareSession: (workspaceId, sessionId) =>
			invokeArtifactCommand(
				workspaceId,
				sessionId,
				new SessionShare({
					requestId: context.nextRequestId("session.share"),
					workspaceId,
					sessionId,
					confirmed: true,
				}),
				"sharing",
			),
		openArtifact: (artifactId) =>
			context.invokeVoid(new ArtifactOpen({ requestId: context.nextRequestId("artifact.open"), artifactId })),
		revealArtifact: (artifactId) =>
			context.invokeVoid(new ArtifactReveal({ requestId: context.nextRequestId("artifact.reveal"), artifactId })),
		openExternalArtifact: (artifactId) =>
			context.invokeVoid(
				new ArtifactOpenExternal({ requestId: context.nextRequestId("artifact.openExternal"), artifactId }),
			),
	};
}

export function emptySessionArtifactOperationState(): SessionArtifactOperationState {
	return { error: undefined, exporting: false, sharing: false };
}
