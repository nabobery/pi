import type { Session } from "electron";

export interface CspSession {
	webRequest: Pick<Session["webRequest"], "onHeadersReceived">;
}

const PRODUCTION_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self'",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"frame-ancestors 'none'",
].join("; ");

const DEVELOPMENT_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self'",
	"connect-src 'self' http://localhost:5173 ws://localhost:5173 http://127.0.0.1:5173 ws://127.0.0.1:5173",
	"object-src 'none'",
	"base-uri 'self'",
	"frame-ancestors 'none'",
].join("; ");

export function getContentSecurityPolicy(isDevelopment: boolean): string {
	return isDevelopment ? DEVELOPMENT_CSP : PRODUCTION_CSP;
}

export function registerContentSecurityPolicy(session: CspSession, isDevelopment: boolean): void {
	const policy = getContentSecurityPolicy(isDevelopment);
	session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [policy],
			},
		});
	});
}
