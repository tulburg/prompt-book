import { Loader2, X } from "lucide-react";

export type DownloadIndicatorTone = "active" | "complete" | "error" | "cancelled";

interface DownloadIndicatorProps {
	title: string;
	message: string;
	tone?: DownloadIndicatorTone;
	onCancel?: () => void;
}

export function DownloadIndicator({
	title,
	message,
	tone = "active",
	onCancel,
}: DownloadIndicatorProps) {
	const toneClassName =
		tone === "error"
			? "border-red-500/30"
			: tone === "complete"
				? "border-emerald-500/30"
				: tone === "cancelled"
					? "border-border-500"
					: "border-border-500";

	return (
		<div className={`flex min-w-[280px] max-w-[420px] items-center gap-3 rounded-xl border bg-panel-500 px-3 py-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.4)] ${toneClassName}`}>
			<div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-500 bg-panel">
				{tone === "active" ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-900" />
				) : (
					<span
						className={`size-2 rounded-full ${
							tone === "complete"
								? "bg-emerald-400"
								: tone === "error"
									? "bg-red-400"
									: "bg-placeholder"
						}`}
					/>
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-medium text-foreground">{title}</div>
				<div className="truncate text-[12px] text-placeholder">{message}</div>
			</div>
			{onCancel && tone === "active" && (
				<button
					type="button"
					className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground"
					onClick={onCancel}
					aria-label={`Cancel download for ${title}`}
					title="Cancel download"
				>
					<X className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}
