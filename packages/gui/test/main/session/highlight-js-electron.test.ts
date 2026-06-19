import { describe, expect, test } from "vitest";
import highlight from "../../../src/main/session/highlight-js-electron.ts";

describe("highlight-js Electron shim", () => {
	test("escapes highlighted code without loading highlight.js in Electron", () => {
		expect(highlight.getLanguage()).toBeUndefined();
		expect(highlight.highlight("<script>&\"'</script>").value).toBe("&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;");
		expect(highlight.highlightAuto("plain").value).toBe("plain");
	});
});
