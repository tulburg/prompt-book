import * as React from "react";
import { createPortal } from "react-dom";

interface ModalProps {
	open: boolean;
	title?: React.ReactNode;
	description?: React.ReactNode;
	onClose: () => void;
	children: React.ReactNode;
	footer?: React.ReactNode;
	className?: string;
	contentClassName?: string;
	closeOnOverlayClick?: boolean;
}

export function Modal({
	open,
	title,
	description,
	onClose,
	children,
	footer,
	className,
	contentClassName,
	closeOnOverlayClick = true,
}: ModalProps) {
	React.useEffect(() => {
		if (!open) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [open, onClose]);

	if (!open) {
		return null;
	}

	return createPortal(
		<div
			className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[1px]"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && closeOnOverlayClick) {
					onClose();
				}
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className={`flex max-h-[min(85vh,760px)] w-full max-w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border-500 bg-panel shadow-[0_18px_70px_rgba(0,0,0,0.45)] ${className ?? ""}`}
			>
				{(title || description) && (
					<div className="shrink-0 border-b border-border-500 px-5 py-4">
						{title && <div className="text-sm font-semibold text-foreground">{title}</div>}
						{description && <div className="mt-1 text-xs leading-relaxed text-placeholder">{description}</div>}
					</div>
				)}
				<div className={`min-h-0 flex-1 overflow-y-auto ${contentClassName ?? ""}`}>{children}</div>
				{footer && <div className="shrink-0 border-t border-border-500 px-5 py-4">{footer}</div>}
			</div>
		</div>,
		document.body,
	);
}
