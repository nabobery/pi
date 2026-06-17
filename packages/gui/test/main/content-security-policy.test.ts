import { describe, expect, test } from "vitest";
import { getContentSecurityPolicy } from "../../src/main/content-security-policy.ts";

describe("getContentSecurityPolicy", () => {
	test("returns a strict production policy", () => {
		const policy = getContentSecurityPolicy(false);

		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain("script-src 'self'");
		expect(policy).toContain("connect-src 'self'");
		expect(policy).not.toContain("'unsafe-eval'");
		expect(policy).not.toContain("localhost:5173");
	});

	test("allows only Vite HMR connections in development", () => {
		const policy = getContentSecurityPolicy(true);

		expect(policy).toContain("script-src 'self' 'unsafe-eval'");
		expect(policy).toContain("http://localhost:5173");
		expect(policy).toContain("ws://localhost:5173");
		expect(policy).toContain("http://127.0.0.1:5173");
		expect(policy).toContain("ws://127.0.0.1:5173");
	});
});
