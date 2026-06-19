/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ModalDialog } from "../../src/renderer/app/modal-dialog.tsx";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

afterEach(() => {
	for (const root of mountedRoots.splice(0)) {
		act(() => root.unmount());
	}
	for (const container of mountedContainers.splice(0)) {
		container.remove();
	}
	document.body.innerHTML = "";
});

describe("ModalDialog", () => {
	test("focuses the requested element and restores previous focus on unmount", () => {
		const previousButton = document.createElement("button");
		previousButton.textContent = "previous";
		document.body.append(previousButton);
		previousButton.focus();
		const mounted = renderDialog(
			<SearchDialog onClose={vi.fn()}>
				<button type="button">Done</button>
			</SearchDialog>,
		);

		expect(document.activeElement).toBe(input(mounted.container));

		act(() => mounted.root.unmount());
		expect(document.activeElement).toBe(previousButton);
	});

	test("traps focus with Tab and Shift+Tab", () => {
		const mounted = renderDialog(
			<SearchDialog onClose={vi.fn()}>
				<button type="button">Done</button>
			</SearchDialog>,
		);
		const searchInput = input(mounted.container);
		const doneButton = button(mounted.container);

		doneButton.focus();
		keyDown(dialog(mounted.container), "Tab");
		expect(document.activeElement).toBe(searchInput);

		searchInput.focus();
		keyDown(dialog(mounted.container), "Tab", { shiftKey: true });
		expect(document.activeElement).toBe(doneButton);
	});

	test("keeps focus inside an empty dialog", () => {
		const mounted = renderDialog(<EmptyDialog onClose={vi.fn()} />);
		const modal = dialog(mounted.container);

		keyDown(modal, "Tab");

		expect(document.activeElement).toBe(modal);
	});

	test("closes on Escape and backdrop clicks only", () => {
		const close = vi.fn();
		const mounted = renderDialog(<SearchDialog onClose={close}>{null}</SearchDialog>);
		const modal = dialog(mounted.container);
		const backdrop = mounted.container.querySelector(".modal-backdrop");
		if (!(backdrop instanceof HTMLElement)) throw new Error("Expected backdrop");

		mouseDown(modal);
		expect(close).not.toHaveBeenCalled();

		keyDown(modal, "Escape");
		expect(close).toHaveBeenCalledOnce();

		mouseDown(backdrop);
		expect(close).toHaveBeenCalledTimes(2);
	});
});

function SearchDialog({ children, onClose }: { children: ReactNode; onClose(): void }) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	return (
		<ModalDialog className="test-dialog" initialFocusRef={inputRef} labelledBy="test-title" onClose={onClose}>
			<h2 id="test-title">Dialog</h2>
			<input ref={inputRef} aria-label="Search" />
			{children}
		</ModalDialog>
	);
}

function EmptyDialog({ onClose }: { onClose(): void }) {
	const initialFocusRef = useRef<HTMLElement | null>(null);
	return (
		<ModalDialog className="test-dialog" initialFocusRef={initialFocusRef} labelledBy="test-title" onClose={onClose}>
			<h2 id="test-title">Dialog</h2>
			<span>No actions</span>
		</ModalDialog>
	);
}

function renderDialog(node: ReactNode): { container: HTMLElement; root: Root } {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedRoots.push(root);
	mountedContainers.push(container);
	act(() => root.render(node));
	return { container, root };
}

function dialog(container: HTMLElement): HTMLElement {
	const element = container.querySelector('[role="dialog"]');
	if (!(element instanceof HTMLElement)) throw new Error("Expected dialog");
	return element;
}

function input(container: HTMLElement): HTMLInputElement {
	const element = container.querySelector('input[aria-label="Search"]');
	if (!(element instanceof HTMLInputElement)) throw new Error("Expected input");
	return element;
}

function button(container: HTMLElement): HTMLButtonElement {
	const element = container.querySelector("button");
	if (!(element instanceof HTMLButtonElement)) throw new Error("Expected button");
	return element;
}

function keyDown(element: HTMLElement, key: string, options: { shiftKey?: boolean } = {}): void {
	act(() => {
		element.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: options.shiftKey, bubbles: true }));
	});
}

function mouseDown(element: HTMLElement): void {
	act(() => {
		element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	});
}
