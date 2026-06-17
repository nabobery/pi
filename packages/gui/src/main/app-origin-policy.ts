import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TRUSTED_DEV_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

export interface AppOriginPolicy {
	packagedRendererUrl: URL;
	allowedDevOrigins: ReadonlySet<string>;
}

export type RendererTarget = { kind: "file"; path: string } | { kind: "url"; url: string };

export function getPackagedRendererEntryUrl(mainProcessDir: string): URL {
	return pathToFileURL(join(mainProcessDir, "../renderer/index.html"));
}

export function createAppOriginPolicy(options: {
	devServerUrl?: string | undefined;
	packagedRendererUrl: URL;
}): AppOriginPolicy {
	const allowedDevOrigins = new Set<string>();

	if (options.devServerUrl) {
		const devServerUrl = parseUrl(options.devServerUrl);
		if (devServerUrl && TRUSTED_DEV_ORIGINS.has(devServerUrl.origin)) {
			allowedDevOrigins.add(devServerUrl.origin);
		}
	}

	return {
		packagedRendererUrl: options.packagedRendererUrl,
		allowedDevOrigins,
	};
}

export function isAllowedAppUrl(policy: AppOriginPolicy, url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol === "file:") {
			return parsedUrl.href === policy.packagedRendererUrl.href;
		}
		return parsedUrl.protocol === "http:" && policy.allowedDevOrigins.has(parsedUrl.origin);
	} catch {
		return false;
	}
}

export function resolveRendererTarget(options: {
	devServerUrl: string | undefined;
	mainProcessDir: string;
}): RendererTarget {
	const packagedRendererUrl = getPackagedRendererEntryUrl(options.mainProcessDir);
	const policy = createAppOriginPolicy({
		devServerUrl: options.devServerUrl,
		packagedRendererUrl,
	});

	if (!options.devServerUrl) {
		return { kind: "file", path: fileURLToPath(packagedRendererUrl) };
	}

	if (!isAllowedAppUrl(policy, options.devServerUrl)) {
		throw new Error(`Refusing to load untrusted renderer URL: ${options.devServerUrl}`);
	}

	return { kind: "url", url: options.devServerUrl };
}

function parseUrl(url: string): URL | undefined {
	try {
		return new URL(url);
	} catch {
		return undefined;
	}
}
