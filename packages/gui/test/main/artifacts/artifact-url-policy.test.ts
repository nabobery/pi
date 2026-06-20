import { describe, expect, test } from "vitest";
import { createExternalArtifactUrlPolicy } from "../../../src/main/artifacts/artifact-url-policy.ts";

describe("createExternalArtifactUrlPolicy", () => {
	test("allows only GitHub gist URLs and configured share previews", () => {
		const isAllowed = createExternalArtifactUrlPolicy({
			getShareViewerUrl: (gistId) => `https://share.local/session/#${gistId}`,
		});

		expect(isAllowed("https://gist.github.com/user/abc123")).toBe(true);
		expect(isAllowed("https://gist.github.com/abc123")).toBe(true);
		expect(isAllowed("https://share.local/session/#abc123")).toBe(true);
	});

	test.each([
		"http://share.local/session/#abc123",
		"https://example.com/session/#abc123",
		"https://share.local/not-session/#abc123",
		"https://share.local/session/?mode=preview#abc123",
		"https://share.local/session/",
		"https://share.local/session/#",
		"https://gist.github.com/",
		"https://gist.example.com/user/abc123",
		"not a url",
	])("rejects %s", (url) => {
		const isAllowed = createExternalArtifactUrlPolicy({
			getShareViewerUrl: (gistId) => `https://share.local/session/#${gistId}`,
		});

		expect(isAllowed(url)).toBe(false);
	});

	test("rejects share previews when the configured preview factory is malformed", () => {
		const isAllowed = createExternalArtifactUrlPolicy({
			getShareViewerUrl: () => "not a url",
		});

		expect(isAllowed("https://share.local/session/#abc123")).toBe(false);
	});
});
