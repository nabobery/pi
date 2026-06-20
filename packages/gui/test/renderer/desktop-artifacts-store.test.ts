import { describe, expect, test, vi } from "vitest";
import {
	InternalIpcError,
	catalogRevisionFromString,
	sessionIdFromString,
	workspaceIdFromString,
	type GuiCommand,
	type GuiCommandResult,
} from "../../src/contracts/index.ts";
import { createGuiCatalogStore } from "../../src/renderer/app/app-store.ts";

const workspaceId = workspaceIdFromString("workspace-1");
const sessionId = sessionIdFromString("session-1");
const key = `${workspaceId}:${sessionId}`;

describe("desktop artifact store actions", () => {
	test("routes attachment and artifact commands through the typed renderer API", async () => {
		const invoke = vi.fn(
			async (command: GuiCommand): Promise<GuiCommandResult> => ({
				ok: true,
				requestId: command.requestId,
				data: undefined,
			}),
		);
		const store = createStore(invoke);

		await store.pickImages(workspaceId, sessionId);
		await store.pasteImageFromClipboard(workspaceId, sessionId);
		await store.removeImageAttachment(workspaceId, sessionId, "image-1");
		await store.clearImageAttachments(workspaceId, sessionId);
		await store.openArtifact("artifact-1");
		await store.revealArtifact("artifact-1");
		await store.openExternalArtifact("artifact-1");

		expect(invoke.mock.calls.map(([command]) => command._tag)).toEqual([
			"composer.pickImages",
			"composer.pasteImageFromClipboard",
			"composer.removeImageAttachment",
			"composer.clearImageAttachments",
			"artifact.open",
			"artifact.reveal",
			"artifact.openExternal",
		]);
		expect(invoke.mock.calls[2][0]).toMatchObject({ attachmentId: "image-1" });
		expect(invoke.mock.calls[4][0]).toMatchObject({ artifactId: "artifact-1" });
	});

	test("records export and share failures in per-session artifact state", async () => {
		const invoke = vi.fn(async (command: GuiCommand): Promise<GuiCommandResult> => {
			if (command._tag === "session.export" || command._tag === "session.share") {
				return {
					ok: false,
					requestId: command.requestId,
					error: new InternalIpcError({ message: "blocked" }),
				};
			}
			return { ok: true, requestId: command.requestId, data: undefined };
		});
		const store = createStore(invoke);

		await store.exportSession(workspaceId, sessionId, "html");
		expect(store.getSnapshot().sessionArtifactStateBySessionKey[key]).toMatchObject({
			error: "blocked",
			exporting: false,
			sharing: false,
		});
		await store.shareSession(workspaceId, sessionId);
		expect(store.getSnapshot().sessionArtifactStateBySessionKey[key]).toMatchObject({
			error: "blocked",
			exporting: false,
			sharing: false,
		});
		expect(invoke.mock.calls.map(([command]) => command._tag)).toEqual(["session.export", "session.share"]);
		expect(invoke.mock.calls[1][0]).toMatchObject({ confirmed: true });
	});
});

function createStore(invoke: (command: GuiCommand) => Promise<GuiCommandResult>) {
	return createGuiCatalogStore(
		{
			invoke,
			subscribe: () => () => undefined,
		},
		{
			revision: catalogRevisionFromString("0"),
			selectedWorkspaceId: workspaceId,
			workspaces: [],
		},
	);
}
