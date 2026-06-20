import { getShareViewerUrl as getDefaultShareViewerUrl } from "@earendil-works/pi-coding-agent/runtime";

export type ShareViewerUrlFactory = (gistId: string) => string;
export type ExternalArtifactUrlPolicy = (url: string) => boolean;

export function createExternalArtifactUrlPolicy(
	options: { getShareViewerUrl?: ShareViewerUrlFactory } = {},
): ExternalArtifactUrlPolicy {
	const getShareViewerUrl = options.getShareViewerUrl ?? getDefaultShareViewerUrl;
	return (url) => isGitHubGistUrl(url) || isShareViewerUrl(url, getShareViewerUrl);
}

function isGitHubGistUrl(value: string): boolean {
	const url = parseUrl(value);
	if (!url) return false;
	return (
		url.protocol === "https:" &&
		url.hostname === "gist.github.com" &&
		url.pathname.split("/").filter(Boolean).length > 0
	);
}

function isShareViewerUrl(value: string, getShareViewerUrl: ShareViewerUrlFactory): boolean {
	const url = parseUrl(value);
	if (!url || url.protocol !== "https:" || !url.hash || url.hash === "#") return false;
	const gistId = url.hash.slice(1);
	if (!gistId) return false;
	const allowedUrl = parseUrl(getShareViewerUrl(gistId));
	if (!allowedUrl) return false;
	return url.href === allowedUrl.href;
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
