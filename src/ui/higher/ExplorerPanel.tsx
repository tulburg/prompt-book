import {
	FilePlus,
	FolderPlus,
	Info,
	Pencil,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import type { ProjectNode, ProjectSnapshot } from "@/lib/project-files";
import { Button } from "@/ui/lower/Button";

interface ExplorerPanelProps extends React.HTMLAttributes<HTMLDivElement> {
	project: ProjectSnapshot | null;
	selectedNode: ProjectNode | null;
	isBusy: boolean;
	onBeginCreate: (kind: "file" | "directory", targetPath?: string) => void;
	onBeginRename: (targetPath: string) => void;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onOpenProjectFolder: () => void | Promise<void>;
	onRefresh: () => void | Promise<void>;
}

function formatTimestamp(value?: number) {
	if (!value) {
		return "N/A";
	}

	return new Date(value).toLocaleString();
}

function formatSize(value?: number) {
	if (typeof value !== "number") {
		return "N/A";
	}

	if (value < 1024) {
		return `${value} B`;
	}

	const units = ["KB", "MB", "GB"];
	let size = value / 1024;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}

	return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function ExplorerPanel({
	className,
	isBusy,
	onBeginCreate,
	onBeginRename,
	onDeleteNode,
	onOpenProjectFolder,
	onRefresh,
	project,
	selectedNode,
}: ExplorerPanelProps) {
	const selectedPath = selectedNode?.path ?? project?.rootPath;
	const canManageSelection = Boolean(selectedNode && selectedNode.path !== project?.rootPath);

	return (
		<div
			className={`flex h-full flex-col rounded-[16px] border-r border-border-500 bg-panel p-4 ${className ?? ""}`}
		>
			<div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground/80">
				<Info className="h-4 w-4" />
				Details
			</div>

			<div className="space-y-3 text-xs text-foreground/70">
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Project
					</div>
					<div>{project?.rootName ?? "No folder opened"}</div>
				</div>
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Selected
					</div>
					<div className="break-all">{selectedNode?.name ?? "Nothing selected"}</div>
				</div>
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Path
					</div>
					<div className="break-all">{selectedPath ?? "N/A"}</div>
				</div>
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Kind
					</div>
					<div>{selectedNode?.kind ?? "N/A"}</div>
				</div>
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Permissions
					</div>
					<div className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4 text-foreground/55" />
						<span>
							{selectedNode?.permissions.read ? "read" : "no-read"} /{" "}
							{selectedNode?.permissions.write ? "write" : "read-only"}
						</span>
					</div>
					{selectedNode?.permissions.message ? (
						<div className="mt-1 text-foreground/45">
							{selectedNode.permissions.message}
						</div>
					) : null}
				</div>
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Modified
					</div>
					<div>{formatTimestamp(selectedNode?.modifiedAt)}</div>
				</div>
				<div>
					<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
						Size
					</div>
					<div>{formatSize(selectedNode?.size)}</div>
				</div>
				{selectedNode?.kind === "directory" ? (
					<div>
						<div className="mb-1 uppercase tracking-[0.2em] text-foreground/40">
							Children
						</div>
						<div>{selectedNode.children?.length ?? 0}</div>
					</div>
				) : null}
			</div>

			<div className="mt-6 grid gap-2">
				<Button onClick={() => void onOpenProjectFolder()}>Open Project Folder</Button>
				<Button
					variant="ghost"
					disabled={!project || isBusy}
					onClick={() => void onRefresh()}
				>
					<RefreshCw className={`mr-2 h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
					Refresh Explorer
				</Button>
				<Button
					variant="ghost"
					disabled={!project}
					onClick={() => onBeginCreate("file", selectedPath)}
				>
					<FilePlus className="mr-2 h-4 w-4" />
					New File
				</Button>
				<Button
					variant="ghost"
					disabled={!project}
					onClick={() => onBeginCreate("directory", selectedPath)}
				>
					<FolderPlus className="mr-2 h-4 w-4" />
					New Folder
				</Button>
				<Button
					variant="ghost"
					disabled={!canManageSelection}
					onClick={() => {
						if (selectedNode) {
							onBeginRename(selectedNode.path);
						}
					}}
				>
					<Pencil className="mr-2 h-4 w-4" />
					Rename
				</Button>
				<Button
					variant="ghost"
					disabled={!canManageSelection}
					onClick={() => {
						if (selectedNode && window.confirm(`Delete "${selectedNode.name}"?`)) {
							void onDeleteNode(selectedNode.path);
						}
					}}
				>
					<Trash2 className="mr-2 h-4 w-4" />
					Delete
				</Button>
			</div>
		</div>
	);
}
