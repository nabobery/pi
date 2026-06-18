import { randomUUID } from "node:crypto";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent/runtime";
import {
	ExtensionUiCompatibilityIssue,
	ExtensionUiRequestNotFound,
	ExtensionUiRequested,
	ExtensionUiResolved,
	ExtensionUiResponseInvalid,
	ExtensionUiSessionMismatch,
	ExtensionUiUpdated,
	extensionUiRequestIdFromString,
	type ExtensionUiRequestId,
	type GuiEvent,
	type SessionId,
	type WorkspaceId,
} from "../../contracts/index.ts";
import { createRuntimeSessionKey } from "./session-key.ts";

export type ExtensionUiResponse =
	| { kind: "confirm"; confirmed: boolean }
	| { kind: "input"; value?: string; cancelled: boolean }
	| { kind: "select"; value?: string; cancelled: boolean }
	| { kind: "editor"; value?: string; cancelled: boolean }
	| { kind: "getEditorText"; value: string };

export interface ExtensionHostEventBus {
	nextEventBase(): ConstructorParameters<typeof ExtensionUiRequested>[0] extends infer Payload
		? Payload extends { eventId: infer EventId; sequence: number }
			? { eventId: EventId; sequence: number }
			: never
		: never;
	publish(event: GuiEvent): void;
}

interface PendingRequest {
	kind: ExtensionUiResponse["kind"];
	workspaceId: WorkspaceId;
	sessionId: SessionId;
	resolve(value: unknown): void;
	cleanup(): void;
}

interface ExtensionUiRequestPayload {
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	timeoutMs?: number;
}

export class ExtensionHostUiService {
	private readonly eventBus: ExtensionHostEventBus;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly editorTextBySession = new Map<string, string>();

	constructor(eventBus: ExtensionHostEventBus) {
		this.eventBus = eventBus;
	}

	createContext(workspaceId: WorkspaceId, sessionId: SessionId): ExtensionUIContext {
		const publishThemeCompatibilityIssue = () => this.publishCompatibilityIssue(workspaceId, sessionId, "theme");
		const context: ExtensionUIContext = {
			select: (title, options, opts) =>
				this.requestString(workspaceId, sessionId, "select", { title, options, timeoutMs: opts?.timeout }, opts),
			confirm: (title, message, opts) =>
				this.requestBoolean(workspaceId, sessionId, "confirm", { title, message, timeoutMs: opts?.timeout }, opts),
			input: (title, placeholder, opts) =>
				this.requestString(workspaceId, sessionId, "input", { title, placeholder, timeoutMs: opts?.timeout }, opts),
			notify: (message, type) => {
				this.publishUpdate(workspaceId, sessionId, { kind: "notify", message, notifyType: type });
			},
			onTerminalInput: () => {
				this.publishCompatibilityIssue(workspaceId, sessionId, "onTerminalInput");
				return () => undefined;
			},
			setStatus: (key, text) => {
				this.publishUpdate(workspaceId, sessionId, { kind: "status", statusKey: key, statusText: text });
			},
			setWorkingMessage: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setWorkingMessage"),
			setWorkingVisible: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setWorkingVisible"),
			setWorkingIndicator: (_options?: WorkingIndicatorOptions) =>
				this.publishCompatibilityIssue(workspaceId, sessionId, "setWorkingIndicator"),
			setHiddenThinkingLabel: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setHiddenThinkingLabel"),
			setWidget: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setWidget"),
			setFooter: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setFooter"),
			setHeader: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setHeader"),
			setTitle: (title) => {
				this.publishUpdate(workspaceId, sessionId, { kind: "title", title });
			},
			custom: () => {
				this.publishCompatibilityIssue(workspaceId, sessionId, "custom");
				return Promise.reject(new Error("Custom extension UI is not supported in Pi GUI"));
			},
			pasteToEditor: (text) => {
				this.setEditorText(workspaceId, sessionId, `${this.getEditorText(workspaceId, sessionId)}${text}`);
			},
			setEditorText: (text) => this.setEditorText(workspaceId, sessionId, text),
			getEditorText: () => this.getEditorText(workspaceId, sessionId),
			editor: (title, prefill) => this.requestString(workspaceId, sessionId, "editor", { title, prefill }),
			addAutocompleteProvider: () =>
				this.publishCompatibilityIssue(workspaceId, sessionId, "addAutocompleteProvider"),
			setEditorComponent: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setEditorComponent"),
			getEditorComponent: () => undefined,
			get theme() {
				return createUnsupportedTheme(publishThemeCompatibilityIssue) as ExtensionUIContext["theme"];
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => {
				this.publishCompatibilityIssue(workspaceId, sessionId, "setTheme");
				return { success: false, error: "Theme mutation is not supported in Pi GUI" };
			},
			getToolsExpanded: () => false,
			setToolsExpanded: () => this.publishCompatibilityIssue(workspaceId, sessionId, "setToolsExpanded"),
		};
		return context;
	}

	respond(request: {
		workspaceId: WorkspaceId;
		sessionId: SessionId;
		extensionUiRequestId: ExtensionUiRequestId;
		response: ExtensionUiResponse;
	}): void {
		const key = pendingKey(request.workspaceId, request.sessionId, request.extensionUiRequestId);
		const pending = this.pending.get(key);
		if (!pending) {
			const mismatched = this.findPendingRequestById(request.extensionUiRequestId);
			if (mismatched) {
				throw new ExtensionUiSessionMismatch({
					workspaceId: request.workspaceId,
					sessionId: request.sessionId,
					extensionUiRequestId: request.extensionUiRequestId,
					message: "Extension UI response belongs to another session",
				});
			}
			throw new ExtensionUiRequestNotFound({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				extensionUiRequestId: request.extensionUiRequestId,
				message: "Extension UI request is not pending",
			});
		}
		if (pending.kind !== request.response.kind) {
			throw new ExtensionUiResponseInvalid({
				workspaceId: request.workspaceId,
				sessionId: request.sessionId,
				extensionUiRequestId: request.extensionUiRequestId,
				message: `Expected ${pending.kind} response, received ${request.response.kind}`,
			});
		}
		pending.cleanup();
		this.pending.delete(key);
		pending.resolve(responseValue(request.response));
		this.publishResolved(request.workspaceId, request.sessionId, request.extensionUiRequestId);
	}

	cancelSessionRequests(workspaceId: WorkspaceId, sessionId: SessionId): void {
		const sessionKeyPrefix = `${createRuntimeSessionKey(workspaceId, sessionId)}:`;
		for (const [key, pending] of this.pending) {
			if (!key.startsWith(sessionKeyPrefix)) continue;
			pending.cleanup();
			this.pending.delete(key);
			pending.resolve(cancelledValue(pending.kind));
			this.publishResolved(
				workspaceId,
				sessionId,
				extensionUiRequestIdFromString(key.slice(sessionKeyPrefix.length)),
			);
		}
		this.editorTextBySession.delete(createRuntimeSessionKey(workspaceId, sessionId));
	}

	updateEditorText(workspaceId: WorkspaceId, sessionId: SessionId, text: string): void {
		this.editorTextBySession.set(createRuntimeSessionKey(workspaceId, sessionId), text);
	}

	private request(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		kind: "confirm" | "input" | "select" | "editor",
		payload: ExtensionUiRequestPayload,
		options?: ExtensionUIDialogOptions,
	): Promise<unknown> {
		if (options?.signal?.aborted) return Promise.resolve(cancelledValue(kind));
		const id = extensionUiRequestIdFromString(`extension-ui-${randomUUID()}`);
		const key = pendingKey(workspaceId, sessionId, id);
		return new Promise((resolve) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				options?.signal?.removeEventListener("abort", onAbort);
			};
			const settle = (value: unknown) => {
				const pending = this.pending.get(key);
				if (!pending) return;
				pending.cleanup();
				this.pending.delete(key);
				resolve(value);
				this.publishResolved(workspaceId, sessionId, id);
			};
			const onAbort = () => settle(cancelledValue(kind));
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			if (payload.timeoutMs) {
				timeoutId = setTimeout(() => settle(cancelledValue(kind)), payload.timeoutMs);
			}
			this.pending.set(key, { kind, workspaceId, sessionId, resolve, cleanup });
			this.eventBus.publish(
				new ExtensionUiRequested({
					...this.eventBus.nextEventBase(),
					request: { id, workspaceId, sessionId, kind, ...payload },
				}),
			);
		});
	}

	private async requestString(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		kind: "input" | "select" | "editor",
		payload: ExtensionUiRequestPayload,
		options?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		const value = await this.request(workspaceId, sessionId, kind, payload, options);
		return typeof value === "string" ? value : undefined;
	}

	private async requestBoolean(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		kind: "confirm",
		payload: ExtensionUiRequestPayload,
		options?: ExtensionUIDialogOptions,
	): Promise<boolean> {
		const value = await this.request(workspaceId, sessionId, kind, payload, options);
		return value === true;
	}

	private publishCompatibilityIssue(workspaceId: WorkspaceId, sessionId: SessionId, method: string): void {
		this.eventBus.publish(
			new ExtensionUiCompatibilityIssue({
				...this.eventBus.nextEventBase(),
				workspaceId,
				sessionId,
				method,
				message: `${method} is not supported in Pi GUI extension UI`,
			}),
		);
	}

	private publishUpdate(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		update: Omit<ConstructorParameters<typeof ExtensionUiUpdated>[0]["update"], "workspaceId" | "sessionId">,
	): void {
		this.eventBus.publish(
			new ExtensionUiUpdated({
				...this.eventBus.nextEventBase(),
				update: { workspaceId, sessionId, ...update },
			}),
		);
	}

	private setEditorText(workspaceId: WorkspaceId, sessionId: SessionId, text: string): void {
		this.editorTextBySession.set(createRuntimeSessionKey(workspaceId, sessionId), text);
		this.publishUpdate(workspaceId, sessionId, { kind: "editorText", editorText: text });
	}

	private getEditorText(workspaceId: WorkspaceId, sessionId: SessionId): string {
		return this.editorTextBySession.get(createRuntimeSessionKey(workspaceId, sessionId)) ?? "";
	}

	private findPendingRequestById(extensionUiRequestId: ExtensionUiRequestId): PendingRequest | undefined {
		for (const [key, pending] of this.pending) {
			if (key.endsWith(`:${extensionUiRequestId}`)) return pending;
		}
		return undefined;
	}

	private publishResolved(
		workspaceId: WorkspaceId,
		sessionId: SessionId,
		extensionUiRequestId: ExtensionUiRequestId,
	): void {
		this.eventBus.publish(
			new ExtensionUiResolved({
				...this.eventBus.nextEventBase(),
				workspaceId,
				sessionId,
				extensionUiRequestId,
			}),
		);
	}
}

function pendingKey(workspaceId: WorkspaceId, sessionId: SessionId, requestId: ExtensionUiRequestId): string {
	return `${createRuntimeSessionKey(workspaceId, sessionId)}:${requestId}`;
}

function responseValue(response: ExtensionUiResponse): unknown {
	if (response.kind === "confirm") return response.confirmed;
	if (response.kind === "getEditorText") return response.value;
	if (response.cancelled) return undefined;
	return response.value;
}

function cancelledValue(kind: ExtensionUiResponse["kind"]): unknown {
	if (kind === "confirm") return false;
	return undefined;
}

function createUnsupportedTheme(onRead: () => void): unknown {
	return new Proxy(
		{},
		{
			get() {
				onRead();
				return "";
			},
		},
	);
}
