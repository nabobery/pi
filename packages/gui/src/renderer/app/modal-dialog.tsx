import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

export function ModalDialog({
	children,
	className,
	initialFocusRef,
	labelledBy,
	onClose,
}: {
	children: ReactNode;
	className: string;
	initialFocusRef: RefObject<HTMLElement | null>;
	labelledBy: string;
	onClose(): void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const focusTarget = initialFocusRef.current ?? firstFocusable(dialogRef.current) ?? dialogRef.current;
		focusTarget?.focus();
		return () => {
			previousFocusRef.current?.focus();
		};
	}, [initialFocusRef]);

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = getFocusable(dialogRef.current);
		if (focusable.length === 0) {
			event.preventDefault();
			dialogRef.current?.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
			return;
		}
		if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	return (
		<div
			className="modal-backdrop"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				aria-labelledby={labelledBy}
				aria-modal="true"
				className={className}
				role="dialog"
				tabIndex={-1}
				onKeyDown={handleKeyDown}
			>
				{children}
			</div>
		</div>
	);
}

function firstFocusable(root: HTMLElement | null): HTMLElement | undefined {
	return getFocusable(root)[0];
}

function getFocusable(root: HTMLElement | null): HTMLElement[] {
	if (!root) return [];
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
		if (element.hasAttribute("disabled")) return false;
		if (element.getAttribute("aria-hidden") === "true") return false;
		return true;
	});
}

const FOCUSABLE_SELECTOR = ["a[href]", "button", "input", "select", "textarea", '[tabindex]:not([tabindex="-1"])'].join(
	",",
);
