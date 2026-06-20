import { describe, expect, test } from "vitest";
import { Effect, Schema } from "effect";
import {
	AppBootstrap,
	AppReady,
	ArtifactOpen,
	ArtifactReveal,
	BootstrapSnapshot,
	CatalogParseFailed,
	CommandNotImplemented,
	ComposerClearImageAttachments,
	ComposerPasteImageFromClipboard,
	ComposerPickImages,
	ComposerRemoveImageAttachment,
	InvalidWorkspacePath,
	GuiCommand,
	GuiError,
	GuiEvent,
	ImageAttachmentBlocked,
	ImageAttachmentLimitExceeded,
	ImageAttachmentSnapshot,
	ImageAttachmentTooLarge,
	ReceiptEmitted,
	ResumeArchive,
	ResumeOpen,
	ResumeRename,
	ResumeSearch,
	ResumeUnarchive,
	ResourcesGetInventory,
	ResourcesOpenSource,
	ResourcesReload,
	ResourcesRevealSource,
	RunCancelled,
	RunCompleted,
	SessionCompact,
	SessionExport,
	SessionExportResultSnapshot,
	SessionExportSnapshot,
	SessionCancelCompaction,
	SessionCancelTreeNavigation,
	SessionCompactionSnapshot,
	SessionCancelFailed,
	SessionArchive,
	SessionCatalogSnapshot,
	SessionClose,
	SessionClosed,
	SessionGetTranscript,
	SessionGetSlashCommands,
	SessionGetTree,
	SettingsGetEditorSnapshot,
	SettingsUpdateCommon,
	SessionPromptFailed,
	SessionPromptRejected,
	SessionRuntimeNotFound,
	SessionRunNotActive,
	SessionSendMessage,
	SessionSetTreeEntryLabel,
	SessionShare,
	SessionShareSnapshot,
	SessionTreeSnapshot,
	SessionTreeUnavailable,
	SessionNavigateTree,
	SessionRename,
	SessionSelected,
	TimelineSnapshot,
	TimelineMessageDelta,
	TreeNavigationSnapshot,
	TreeUpdated,
	TrustSaveDecision,
	WorkspacePickDirectory,
	WorkspaceRemove,
	WorkspaceSynced,
	decodeGuiCommand,
	decodeGuiError,
	decodeGuiEvent,
	decodeResumeSearchSnapshot,
	decodeSlashCommandCatalogSnapshot,
	decodeTimelineSnapshot,
	eventIdFromString,
	requestIdFromString,
	runIdFromString,
	sessionIdFromString,
	workspaceIdFromString,
} from "../../src/contracts/index.ts";

describe("gui contracts", () => {
	test("decodes valid commands", async () => {
		const command = await decodeGuiCommand(new AppBootstrap({ requestId: requestIdFromString("request-1") }));

		expect(command).toBeInstanceOf(AppBootstrap);
		expect(command.requestId).toBe("request-1");
	});

	test("decodes workspace and session commands", async () => {
		await expect(
			decodeGuiCommand(new WorkspacePickDirectory({ requestId: requestIdFromString("request-2") })),
		).resolves.toBeInstanceOf(WorkspacePickDirectory);
		await expect(
			decodeGuiCommand(
				new WorkspaceRemove({
					requestId: requestIdFromString("request-3"),
					workspaceId: workspaceIdFromString("workspace-1"),
				}),
			),
		).resolves.toBeInstanceOf(WorkspaceRemove);
		await expect(
			decodeGuiCommand(
				new SessionRename({
					requestId: requestIdFromString("request-4"),
					workspaceId: workspaceIdFromString("workspace-1"),
					sessionId: sessionIdFromString("session-1"),
					title: "Renamed",
				}),
			),
		).resolves.toBeInstanceOf(SessionRename);
		await expect(
			decodeGuiCommand(
				new SessionArchive({
					requestId: requestIdFromString("request-5"),
					workspaceId: workspaceIdFromString("workspace-1"),
					sessionId: sessionIdFromString("session-1"),
				}),
			),
		).resolves.toBeInstanceOf(SessionArchive);
	});

	test("decodes runtime-scoped session commands with workspace identity", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			decodeGuiCommand(new SessionClose({ requestId: requestIdFromString("request-6"), workspaceId, sessionId })),
		).resolves.toBeInstanceOf(SessionClose);
		await expect(
			decodeGuiCommand(
				new SessionGetTranscript({ requestId: requestIdFromString("request-7"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(SessionGetTranscript);
		await expect(decodeGuiCommand({ _tag: "session.close", requestId: "request-8", sessionId })).rejects.toThrow();
	});

	test("decodes slash command and resume commands", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			decodeGuiCommand(
				new SessionGetSlashCommands({ requestId: requestIdFromString("request-slash"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(SessionGetSlashCommands);
		await expect(
			decodeGuiCommand(
				new ResumeSearch({
					requestId: requestIdFromString("request-resume-search"),
					workspaceId,
					query: "hello",
					scope: "currentWorkspace",
					sortMode: "threaded",
					nameFilter: "all",
					includeArchived: false,
				}),
			),
		).resolves.toBeInstanceOf(ResumeSearch);
		await expect(
			decodeGuiCommand(
				new ResumeOpen({ requestId: requestIdFromString("request-resume-open"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(ResumeOpen);
		await expect(
			decodeGuiCommand(
				new ResumeRename({
					requestId: requestIdFromString("request-resume-rename"),
					workspaceId,
					sessionId,
					title: "Renamed",
				}),
			),
		).resolves.toBeInstanceOf(ResumeRename);
		await expect(
			decodeGuiCommand(
				new ResumeArchive({ requestId: requestIdFromString("request-resume-archive"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(ResumeArchive);
		await expect(
			decodeGuiCommand(
				new ResumeUnarchive({ requestId: requestIdFromString("request-resume-unarchive"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(ResumeUnarchive);
	});

	test("decodes tree and compaction commands", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			decodeGuiCommand(
				new SessionGetTree({ requestId: requestIdFromString("request-tree"), workspaceId, sessionId }),
			),
		).resolves.toBeInstanceOf(SessionGetTree);
		await expect(
			decodeGuiCommand(
				new SessionNavigateTree({
					requestId: requestIdFromString("request-tree-nav"),
					workspaceId,
					sessionId,
					targetEntryId: "entry-user-1",
					summaryMode: "custom",
					customInstructions: "focus on decisions",
				}),
			),
		).resolves.toBeInstanceOf(SessionNavigateTree);
		await expect(
			decodeGuiCommand(
				new SessionSetTreeEntryLabel({
					requestId: requestIdFromString("request-tree-label"),
					workspaceId,
					sessionId,
					entryId: "entry-user-1",
					label: "checkpoint",
				}),
			),
		).resolves.toBeInstanceOf(SessionSetTreeEntryLabel);
		await expect(
			decodeGuiCommand(
				new SessionCompact({
					requestId: requestIdFromString("request-compact"),
					workspaceId,
					sessionId,
					customInstructions: "keep file edits",
				}),
			),
		).resolves.toBeInstanceOf(SessionCompact);
		await expect(
			decodeGuiCommand(
				new SessionCancelCompaction({
					requestId: requestIdFromString("request-cancel-compact"),
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(SessionCancelCompaction);
		await expect(
			decodeGuiCommand(
				new SessionCancelTreeNavigation({
					requestId: requestIdFromString("request-cancel-tree"),
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(SessionCancelTreeNavigation);
	});

	test("decodes control plane settings, trust, and resource commands", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			decodeGuiCommand(
				new SettingsGetEditorSnapshot({ requestId: requestIdFromString("request-settings-editor"), workspaceId }),
			),
		).resolves.toBeInstanceOf(SettingsGetEditorSnapshot);
		await expect(
			decodeGuiCommand(
				new SettingsUpdateCommon({
					requestId: requestIdFromString("request-settings-update"),
					workspaceId,
					scope: "global",
					patch: { defaultProvider: "openrouter", enableSkillCommands: true },
				}),
			),
		).resolves.toBeInstanceOf(SettingsUpdateCommon);
		await expect(
			decodeGuiCommand(
				new TrustSaveDecision({
					requestId: requestIdFromString("request-trust-save"),
					workspaceId,
					optionId: "0-trust",
				}),
			),
		).resolves.toBeInstanceOf(TrustSaveDecision);
		await expect(
			decodeGuiCommand(
				new ResourcesGetInventory({ requestId: requestIdFromString("request-resources"), workspaceId }),
			),
		).resolves.toBeInstanceOf(ResourcesGetInventory);
		await expect(
			decodeGuiCommand(
				new ResourcesReload({
					requestId: requestIdFromString("request-resources-reload"),
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(ResourcesReload);
		await expect(
			decodeGuiCommand(
				new ResourcesOpenSource({
					requestId: requestIdFromString("request-resource-open"),
					workspaceId,
					resourceId: "skill:/tmp/skill/SKILL.md",
				}),
			),
		).resolves.toBeInstanceOf(ResourcesOpenSource);
		await expect(
			decodeGuiCommand(
				new ResourcesRevealSource({
					requestId: requestIdFromString("request-resource-reveal"),
					workspaceId,
					resourceId: "skill:/tmp/skill/SKILL.md",
				}),
			),
		).resolves.toBeInstanceOf(ResourcesRevealSource);
		await expect(
			decodeGuiCommand({
				_tag: "settings.updateCommon",
				requestId: "request-invalid-settings-update",
				workspaceId,
				scope: "project",
				patch: { defaultProvider: "openrouter" },
			}),
		).rejects.toThrow();
		await expect(
			decodeGuiCommand({
				_tag: "settings.updateCommon",
				requestId: "request-empty-settings-update",
				workspaceId,
				scope: "global",
				patch: { defaultProvider: "" },
			}),
		).rejects.toThrow();
		await expect(
			decodeGuiCommand({
				_tag: "trust.saveDecision",
				requestId: "request-empty-trust-option",
				workspaceId,
				optionId: "",
			}),
		).rejects.toThrow();
		await expect(
			decodeGuiCommand({
				_tag: "resources.openSource",
				requestId: "request-empty-resource-id",
				workspaceId,
				resourceId: "",
			}),
		).rejects.toThrow();
	});

	test("decodes image attachment, export, share, and artifact commands", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			decodeGuiCommand(
				new ComposerPickImages({
					requestId: requestIdFromString("request-image-pick"),
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(ComposerPickImages);
		await expect(
			decodeGuiCommand(
				new ComposerPasteImageFromClipboard({
					requestId: requestIdFromString("request-image-paste"),
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(ComposerPasteImageFromClipboard);
		await expect(
			decodeGuiCommand(
				new ComposerRemoveImageAttachment({
					requestId: requestIdFromString("request-image-remove"),
					workspaceId,
					sessionId,
					attachmentId: "image-1",
				}),
			),
		).resolves.toBeInstanceOf(ComposerRemoveImageAttachment);
		await expect(
			decodeGuiCommand(
				new ComposerClearImageAttachments({
					requestId: requestIdFromString("request-image-clear"),
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(ComposerClearImageAttachments);
		await expect(
			decodeGuiCommand(
				new SessionSendMessage({
					requestId: requestIdFromString("request-image-send"),
					workspaceId,
					sessionId,
					message: "Describe this",
					attachmentIds: ["image-1"],
				}),
			),
		).resolves.toBeInstanceOf(SessionSendMessage);
		await expect(
			decodeGuiCommand(
				new SessionExport({
					requestId: requestIdFromString("request-export"),
					workspaceId,
					sessionId,
					format: "html",
				}),
			),
		).resolves.toBeInstanceOf(SessionExport);
		await expect(
			decodeGuiCommand(
				new SessionShare({
					requestId: requestIdFromString("request-share"),
					workspaceId,
					sessionId,
					confirmed: true,
				}),
			),
		).resolves.toBeInstanceOf(SessionShare);
		await expect(
			decodeGuiCommand({
				_tag: "session.share",
				requestId: "request-share-unconfirmed",
				workspaceId,
				sessionId,
			}),
		).rejects.toThrow();
		await expect(
			decodeGuiCommand(
				new ArtifactOpen({ requestId: requestIdFromString("request-open"), artifactId: "artifact-1" }),
			),
		).resolves.toBeInstanceOf(ArtifactOpen);
		await expect(
			decodeGuiCommand(
				new ArtifactReveal({ requestId: requestIdFromString("request-reveal"), artifactId: "artifact-1" }),
			),
		).resolves.toBeInstanceOf(ArtifactReveal);
	});

	test("decodes rich desktop attachment export and share snapshots and errors", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(ImageAttachmentSnapshot)({
					id: "image-1",
					workspaceId,
					sessionId,
					source: "file",
					fileName: "screen.png",
					mimeType: "image/png",
					sizeBytes: 12,
					previewDataUrl: "data:image/png;base64,abcd",
					createdAt: "2026-06-20T00:00:00.000Z",
				}),
			),
		).resolves.toMatchObject({ id: "image-1", source: "file" });
		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(SessionExportSnapshot)({
					artifactId: "artifact-1",
					workspaceId,
					sessionId,
					format: "html",
					outputPath: "/tmp/session.html",
					createdAt: "2026-06-20T00:00:00.000Z",
				}),
			),
		).resolves.toMatchObject({ artifactId: "artifact-1", format: "html" });
		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(SessionExportResultSnapshot)({
					status: "exported",
					artifact: {
						artifactId: "artifact-1",
						workspaceId,
						sessionId,
						format: "html",
						outputPath: "/tmp/session.html",
						createdAt: "2026-06-20T00:00:00.000Z",
					},
				}),
			),
		).resolves.toMatchObject({ status: "exported" });
		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(SessionExportResultSnapshot)({
					status: "cancelled",
					workspaceId,
					sessionId,
					format: "jsonl",
				}),
			),
		).resolves.toMatchObject({ status: "cancelled" });
		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(SessionShareSnapshot)({
					workspaceId,
					sessionId,
					gistUrl: "https://gist.github.com/user/abc123",
					previewUrl: "https://pi.dev/session/#abc123",
					createdAt: "2026-06-20T00:00:00.000Z",
				}),
			),
		).resolves.toMatchObject({ gistUrl: "https://gist.github.com/user/abc123" });
		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(SessionShareSnapshot)({
					workspaceId,
					sessionId,
					gistUrl: "http://gist.github.com/user/abc123",
					previewUrl: "https://pi.dev/session/#abc123",
					createdAt: "2026-06-20T00:00:00.000Z",
				}),
			),
		).rejects.toThrow();
		await expect(
			Effect.runPromise(
				Schema.decodeUnknown(SessionShareSnapshot)({
					workspaceId,
					sessionId,
					gistUrl: "https://gist.github.com/user/abc123",
					previewUrl: "javascript:alert(1)",
					createdAt: "2026-06-20T00:00:00.000Z",
				}),
			),
		).rejects.toThrow();
		await expect(
			decodeGuiError(new ImageAttachmentBlocked({ workspaceId, sessionId, message: "Images are blocked" })),
		).resolves.toBeInstanceOf(ImageAttachmentBlocked);
		await expect(
			decodeGuiError(
				new ImageAttachmentTooLarge({
					workspaceId,
					sessionId,
					sizeBytes: 2,
					maxBytes: 1,
					message: "too large",
				}),
			),
		).resolves.toBeInstanceOf(ImageAttachmentTooLarge);
		await expect(
			decodeGuiError(
				new ImageAttachmentLimitExceeded({
					workspaceId,
					sessionId,
					maxAttachments: 8,
					message: "too many",
				}),
			),
		).resolves.toBeInstanceOf(ImageAttachmentLimitExceeded);
	});

	test("decodes prompt commands with explicit running delivery modes", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		const idleCommand = await decodeGuiCommand(
			new SessionSendMessage({
				requestId: requestIdFromString("request-9"),
				workspaceId,
				sessionId,
				message: "hello",
			}),
		);
		const runningCommand = await decodeGuiCommand(
			new SessionSendMessage({
				requestId: requestIdFromString("request-10"),
				workspaceId,
				sessionId,
				message: "adjust",
				deliveryMode: "steer",
			}),
		);

		expect(idleCommand).toBeInstanceOf(SessionSendMessage);
		expect(runningCommand).toMatchObject({ deliveryMode: "steer" });
		await expect(
			decodeGuiCommand({
				_tag: "session.sendMessage",
				requestId: "request-11",
				workspaceId,
				sessionId,
				message: "bad",
				deliveryMode: "now",
			}),
		).rejects.toThrow();
	});

	test("rejects commands with unknown tags", async () => {
		await expect(decodeGuiCommand({ _tag: "unknown.command", requestId: "request-1" })).rejects.toThrow();
	});

	test("rejects commands with missing required payload fields", async () => {
		await expect(decodeGuiCommand({ _tag: "workspace.select", requestId: "request-1" })).rejects.toThrow();
	});

	test("rejects invalid branded IDs", async () => {
		await expect(
			decodeGuiCommand({ _tag: "workspace.select", requestId: "request-1", workspaceId: "" }),
		).rejects.toThrow();
	});

	test("creates branded IDs from valid strings", () => {
		expect(workspaceIdFromString("workspace-1")).toBe("workspace-1");
	});

	test("decodes events", async () => {
		const event = await decodeGuiEvent(
			new ReceiptEmitted({
				eventId: eventIdFromString("event-1"),
				sequence: 1,
				receipt: "app.bootstrap.completed",
				requestId: requestIdFromString("request-1"),
			}),
		);

		expect(event).toBeInstanceOf(ReceiptEmitted);
		expect(event.sequence).toBe(1);
	});

	test("decodes tree and compaction snapshots and events", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const tree = {
			workspaceId,
			sessionId,
			leafEntryId: "entry-assistant-1",
			entries: [
				{
					entryId: "entry-user-1",
					parentId: null,
					childIds: ["entry-assistant-1"],
					depth: 0,
					kind: "user",
					textPreview: "hello",
					label: "start",
					isActiveLeaf: false,
					isActivePath: true,
					hasChildren: true,
					searchText: "user hello start",
				},
				{
					entryId: "entry-assistant-1",
					parentId: "entry-user-1",
					childIds: [],
					depth: 1,
					kind: "assistant",
					textPreview: "hi",
					isActiveLeaf: true,
					isActivePath: true,
					hasChildren: false,
					searchText: "assistant hi",
				},
			],
			updatedAt: "2026-06-20T00:00:00.000Z",
		} as const;

		await expect(Effect.runPromise(SessionTreeSnapshot.pipe(Schema.decodeUnknown)(tree))).resolves.toEqual(tree);
		await expect(
			Effect.runPromise(
				TreeNavigationSnapshot.pipe(Schema.decodeUnknown)({
					workspaceId,
					sessionId,
					tree,
					timeline: { workspaceId, sessionId, entries: [] },
					editorText: "hello",
					clearsComposer: false,
					cancelled: false,
				}),
			),
		).resolves.toMatchObject({ editorText: "hello" });
		await expect(
			Effect.runPromise(
				SessionCompactionSnapshot.pipe(Schema.decodeUnknown)({
					workspaceId,
					sessionId,
					summary: "Compacted",
					tokensBefore: 1200,
					timeline: { workspaceId, sessionId, entries: [] },
					tree,
					cancelled: false,
				}),
			),
		).resolves.toMatchObject({ summary: "Compacted" });
		await expect(
			Effect.runPromise(SessionTreeSnapshot.pipe(Schema.decodeUnknown)({ ...tree, entries: [{ bad: true }] })),
		).rejects.toThrow();
		await expect(
			decodeGuiEvent(
				new TreeUpdated({
					eventId: eventIdFromString("event-tree"),
					sequence: 99,
					tree,
				}),
			),
		).resolves.toBeInstanceOf(TreeUpdated);
		await expect(
			decodeGuiError(
				new SessionTreeUnavailable({
					workspaceId,
					sessionId,
					message: "Tree is unavailable",
				}),
			),
		).resolves.toBeInstanceOf(SessionTreeUnavailable);
	});

	test("decodes catalog events", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		await expect(
			decodeGuiEvent(
				new WorkspaceSynced({
					eventId: eventIdFromString("event-2"),
					sequence: 2,
					workspaceId,
					sessions: {
						workspaceId,
						selectedSessionId: sessionId,
						sessions: [],
					},
				}),
			),
		).resolves.toBeInstanceOf(WorkspaceSynced);
		await expect(
			decodeGuiEvent(
				new SessionSelected({
					eventId: eventIdFromString("event-3"),
					sequence: 3,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(SessionSelected);
		await expect(
			decodeGuiEvent(
				new SessionClosed({
					eventId: eventIdFromString("event-4"),
					sequence: 4,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(SessionClosed);
	});

	test("decodes workspace-scoped prompt runtime events", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const runId = runIdFromString("run-1");

		await expect(
			decodeGuiEvent(
				new TimelineMessageDelta({
					eventId: eventIdFromString("event-5"),
					sequence: 5,
					workspaceId,
					runId,
					sessionId,
					text: "hello",
				}),
			),
		).resolves.toBeInstanceOf(TimelineMessageDelta);
		await expect(
			decodeGuiEvent(
				new RunCompleted({
					eventId: eventIdFromString("event-6"),
					sequence: 6,
					runId,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(RunCompleted);
		await expect(
			decodeGuiEvent(
				new RunCancelled({
					eventId: eventIdFromString("event-7"),
					sequence: 7,
					runId,
					workspaceId,
					sessionId,
				}),
			),
		).resolves.toBeInstanceOf(RunCancelled);
		await expect(
			decodeGuiEvent({
				_tag: "timeline.messageDelta",
				eventId: "event-8",
				sequence: 8,
				sessionId,
				text: "missing workspace",
			}),
		).rejects.toThrow();
	});

	test("decodes error serialization", async () => {
		const error = await decodeGuiError(
			new CommandNotImplemented({
				commandTag: "session.open",
				message: "Command is not implemented",
			}),
		);

		expect(error).toBeInstanceOf(CommandNotImplemented);
		expect(error._tag).toBe("CommandNotImplemented");
	});

	test("decodes catalog errors", async () => {
		const error = await decodeGuiError(
			new InvalidWorkspacePath({
				path: "/missing/project",
				message: "Workspace path does not exist",
			}),
		);

		expect(error).toBeInstanceOf(InvalidWorkspacePath);
		expect(error._tag).toBe("InvalidWorkspacePath");
	});

	test("decodes runtime errors", async () => {
		const error = await decodeGuiError(
			new SessionRuntimeNotFound({
				workspaceId: "workspace-1",
				sessionId: "session-1",
				message: "Runtime is not open",
			}),
		);

		expect(error).toBeInstanceOf(SessionRuntimeNotFound);
		expect(error._tag).toBe("SessionRuntimeNotFound");
	});

	test("decodes prompt errors", async () => {
		await expect(
			decodeGuiError(
				new SessionPromptRejected({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					message: "Prompt rejected",
				}),
			),
		).resolves.toBeInstanceOf(SessionPromptRejected);
		await expect(
			decodeGuiError(
				new SessionPromptFailed({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					runId: "run-1",
					message: "Prompt failed",
				}),
			),
		).resolves.toBeInstanceOf(SessionPromptFailed);
		await expect(
			decodeGuiError(
				new SessionCancelFailed({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					runId: "run-1",
					message: "Cancel failed",
				}),
			),
		).resolves.toBeInstanceOf(SessionCancelFailed);
		await expect(
			decodeGuiError(
				new SessionRunNotActive({
					workspaceId: "workspace-1",
					sessionId: "session-1",
					message: "No active run",
				}),
			),
		).resolves.toBeInstanceOf(SessionRunNotActive);
	});

	test("decodes session catalog snapshots", () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		expect(
			SessionCatalogSnapshot.make({
				workspaceId,
				selectedSessionId: sessionId,
				sessions: [
					{
						id: sessionId,
						workspaceId,
						title: "Session one",
						status: "cancelling",
						updatedAt: "2026-06-18T00:00:00.000Z",
						preview: "Preview",
						messageCount: 2,
						sessionFilePath: "/tmp/session.jsonl",
					},
				],
			}),
		).toMatchObject({ workspaceId, selectedSessionId: sessionId });
	});

	test("decodes timeline snapshots with workspace identity", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");

		expect(
			TimelineSnapshot.make({
				workspaceId,
				sessionId,
				entries: [{ id: "entry-1", kind: "user", text: "hello" }],
			}),
		).toEqual({
			workspaceId,
			sessionId,
			entries: [{ id: "entry-1", kind: "user", text: "hello" }],
		});
		await expect(
			decodeTimelineSnapshot({
				sessionId,
				entries: [],
			}),
		).rejects.toThrow();
	});

	test("decodes slash command and resume snapshots", async () => {
		const workspaceId = workspaceIdFromString("workspace-1");
		const sessionId = sessionIdFromString("session-1");
		const slashCatalog = await decodeSlashCommandCatalogSnapshot({
			workspaceId,
			sessionId,
			updatedAt: "2026-06-19T00:00:00.000Z",
			commands: [
				{
					name: "resume",
					description: "Resume a different session",
					source: "builtin",
					availability: "guiAction",
				},
			],
		});
		const resumeSearch = await decodeResumeSearchSnapshot({
			workspaceId,
			query: "hello",
			scope: "currentWorkspace",
			sortMode: "threaded",
			nameFilter: "all",
			includeArchived: false,
			totalCount: 1,
			filteredCount: 1,
			searchedAt: "2026-06-19T00:00:00.000Z",
			results: [
				{
					workspaceId,
					workspaceName: "workspace",
					sessionId,
					title: "Session",
					preview: "hello",
					messageCount: 1,
					updatedAt: "2026-06-19T00:00:00.000Z",
					createdAt: "2026-06-19T00:00:00.000Z",
					cwd: "/tmp/workspace",
					sessionFilePath: "/tmp/session.jsonl",
					isOpen: true,
					isRunning: false,
				},
			],
		});

		expect(slashCatalog.commands[0]).toMatchObject({ name: "resume", availability: "guiAction" });
		expect(resumeSearch.results[0]).toMatchObject({ title: "Session", isOpen: true });
	});

	test("decodes bootstrap snapshots with warnings", () => {
		expect(
			BootstrapSnapshot.make({
				appInfo: {
					name: "Pi GUI",
					version: "1.2.3",
					mode: "test",
				},
				warnings: [
					new CatalogParseFailed({
						message: "Failed to parse GUI catalog",
						backupPath: "/tmp/catalog.invalid",
					}),
				],
			}),
		).toMatchObject({
			warnings: [expect.objectContaining({ _tag: "CatalogParseFailed" })],
		});
	});

	test("exports command, event, and error union schemas", () => {
		expect(GuiCommand).toBeDefined();
		expect(GuiEvent).toBeDefined();
		expect(GuiError).toBeDefined();
		expect(AppReady).toBeDefined();
	});
});
