import type { ImageContent } from "@earendil-works/pi-ai";
import type { SessionId, WorkspaceId } from "../../contracts/index.ts";

export interface SessionImageAttachmentResolver {
	consume(workspaceId: WorkspaceId, sessionId: SessionId, attachmentIds: readonly string[]): ImageContent[];
	consumeForSend?(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		attachmentIds: readonly string[],
	): Promise<ImageContent[]>;
}

export async function consumeSessionImages(
	resolver: SessionImageAttachmentResolver | undefined,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	attachmentIds: readonly string[] | undefined,
): Promise<ImageContent[] | undefined> {
	if (!attachmentIds || attachmentIds.length === 0) return undefined;
	if (resolver?.consumeForSend) {
		return resolver.consumeForSend(workspaceId, sessionId, attachmentIds);
	}
	return resolver?.consume(workspaceId, sessionId, attachmentIds);
}
