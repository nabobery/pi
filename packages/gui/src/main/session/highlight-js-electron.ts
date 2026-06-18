interface HighlightResult {
	value: string;
}

function toResult(code: string): HighlightResult {
	return { value: escapeHtml(code) };
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export default {
	getLanguage: () => undefined,
	highlight: (code: string) => toResult(code),
	highlightAuto: (code: string) => toResult(code),
};
