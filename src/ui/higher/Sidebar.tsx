import {
	ChevronDown,
	ChevronRight,
	FilePlus,
	Folder,
	FolderOpen,
	FolderPlus,
	Pencil,
	RefreshCw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import * as React from "react";
import type { NativeContextMenuItem } from "@/lib/native-context-menu";
import type { GitFileStatus, GitStatusMap, ProjectNode, ProjectNodeKind, ProjectSnapshot } from "@/lib/project-files";
import { injectSetiFont, resolveFileIcon, toSetiGlyph } from "@/extensions/theme-seti/file-icons";
import { Button } from "@/ui/lower/Button";

const HIDDEN_ENTRIES = new Set([
	".git",
	".svn",
	".hg",
	".DS_Store",
	"node_modules",
	"__pycache__",
	".next",
	".nuxt",
	".turbo",
	"dist",
	"dist-electron",
	".cache",
	".parcel-cache",
	"coverage",
	".env.local",
	"Thumbs.db",
]);

const GIT_STATUS_COLORS: Record<GitFileStatus, string> = {
	modified: "text-yellow-400",
	added: "text-green-400",
	deleted: "text-red-400",
	renamed: "text-cyan-400",
	untracked: "text-green-500",
	ignored: "text-foreground/30",
	conflict: "text-orange-400",
};

const GIT_STATUS_LABELS: Record<GitFileStatus, string> = {
	modified: "M",
	added: "A",
	deleted: "D",
	renamed: "R",
	untracked: "U",
	ignored: "!",
	conflict: "C",
};

function getDirectoryGitStatus(
	node: ProjectNode,
	gitStatus: GitStatusMap,
): GitFileStatus | null {
	if (node.kind !== "directory") return null;

	const prefix = node.path.endsWith("/") ? node.path : `${node.path}/`;
	const childStatuses = Object.keys(gitStatus).filter(
		(p) => p.startsWith(prefix),
	);

	if (childStatuses.length === 0) return null;
	return "modified";
}

function matchesFilter(node: ProjectNode, filter: string): boolean {
	if (!filter) return true;
	const lower = filter.toLowerCase();
	if (node.name.toLowerCase().includes(lower)) return true;
	if (node.kind === "directory" && node.children) {
		return node.children.some((child) => matchesFilter(child, filter));
	}
	return false;
}

function isHidden(name: string): boolean {
	return HIDDEN_ENTRIES.has(name);
}

function FileIcon({ fileName }: { fileName: string }) {
	const icon = resolveFileIcon(fileName, false);
	if (!icon) return null;
	const glyph = toSetiGlyph(icon.character);

	if (!glyph) {
		return null;
	}

	return (
		<span
			className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
			style={{
				fontFamily: "seti",
				fontSize: "16px",
				color: icon.color,
				lineHeight: 1,
				WebkitFontSmoothing: "antialiased",
			}}
		>
			{glyph}
		</span>
	);
}

interface PendingCreateState {
	parentPath: string;
	kind: ProjectNodeKind;
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
	project: ProjectSnapshot | null;
	selectedPath: string | null;
	activeFilePath: string | null;
	expandedPaths: Set<string>;
	pendingCreate: PendingCreateState | null;
	renamingPath: string | null;
	isBusy: boolean;
	error: string | null;
	gitStatus: GitStatusMap;
	onOpenProjectFolder: () => void | Promise<void>;
	onRefresh: () => void | Promise<void>;
	onOpenNode: (node: ProjectNode) => void | Promise<void>;
	onBeginCreate: (kind: ProjectNodeKind, targetPath?: string) => void;
	onCreateNode: (name: string) => void | Promise<void>;
	onBeginRename: (targetPath: string) => void;
	onRenameNode: (name: string) => void | Promise<void>;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onMoveNode: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>;
	onCancelInlineState: () => void;
	onSelectNode: (node: ProjectNode) => void;
	onRevealPath: (targetPath: string) => void;
}

interface ContextMenuState {
	node: ProjectNode;
	x: number;
	y: number;
}

function buildContextMenuItems(node: ProjectNode): NativeContextMenuItem[] {
	const items: NativeContextMenuItem[] = [];

	if (node.kind === "directory") {
		items.push(
			{
				type: "action",
				id: "new-file",
				label: "New File",
				accelerator: "CmdOrCtrl+N",
			},
			{
				type: "action",
				id: "new-folder",
				label: "New Folder",
				accelerator: "CmdOrCtrl+Shift+N",
			},
		);
	}

	if (node.parentPath) {
		if (items.length > 0) {
			items.push({ type: "separator" });
		}
		items.push(
			{ type: "action", id: "rename", label: "Rename", accelerator: "Enter" },
			{ type: "action", id: "delete", label: "Delete", accelerator: "Backspace" },
		);
	}

	return items;
}

function InlineNameForm({
	autoFocus = true,
	initialValue,
	label,
	onCancel,
	onSubmit,
}: {
	autoFocus?: boolean;
	initialValue: string;
	label: string;
	onCancel: () => void;
	onSubmit: (value: string) => void | Promise<void>;
}) {
	const [value, setValue] = React.useState(initialValue);

	return (
		<form
			className="flex w-full items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void onSubmit(value);
			}}
		>
			<input
				autoFocus={autoFocus}
				value={value}
				onBlur={() => {
					if (!value.trim()) {
						onCancel();
					}
				}}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
				className="h-8 w-full rounded-md border border-border-500 bg-panel-600 px-2 text-sm text-foreground outline-none focus:border-sky-500"
				placeholder={label}
			/>
		</form>
	);
}

function ProjectTree({
	depth = 0,
	expandedPaths,
	filter,
	gitStatus,
	node,
	activeFilePath,
	onBeginCreate,
	onBeginRename,
	onCancelInlineState,
	onCreateNode,
	onDeleteNode,
	onMoveNode,
	onOpenNode,
	onRenameNode,
	onSelectNode,
	onOpenContextMenu,
	pendingCreate,
	renamingPath,
	selectedPath,
}: {
	depth?: number;
	expandedPaths: Set<string>;
	filter: string;
	gitStatus: GitStatusMap;
	node: ProjectNode;
	activeFilePath: string | null;
	onBeginCreate: (kind: ProjectNodeKind, targetPath?: string) => void;
	onBeginRename: (targetPath: string) => void;
	onCancelInlineState: () => void;
	onCreateNode: (name: string) => void | Promise<void>;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onMoveNode: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>;
	onOpenNode: (node: ProjectNode) => void | Promise<void>;
	onRenameNode: (name: string) => void | Promise<void>;
	onSelectNode: (node: ProjectNode) => void;
	onOpenContextMenu: (node: ProjectNode, x: number, y: number) => void;
	pendingCreate: PendingCreateState | null;
	renamingPath: string | null;
	selectedPath: string | null;
}) {
	const isDirectory = node.kind === "directory";
	const isExpanded = expandedPaths.has(node.path);
	const isSelected = selectedPath === node.path;
	const isActiveFile = activeFilePath === node.path;
	const isRenaming = renamingPath === node.path;
	const showInlineCreate = pendingCreate?.parentPath === node.path && isDirectory;

	const fileGitStatus = gitStatus[node.path] as GitFileStatus | undefined;
	const dirGitStatus = isDirectory ? getDirectoryGitStatus(node, gitStatus) : null;
	const effectiveGitStatus = fileGitStatus ?? dirGitStatus;
	const gitColorClass = effectiveGitStatus ? GIT_STATUS_COLORS[effectiveGitStatus] : "";

	const fileIcon = !isDirectory ? resolveFileIcon(node.name, false) : null;

	const handleDragStart = React.useCallback(
		(event: React.DragEvent) => {
			event.dataTransfer.setData("text/plain", node.path);
			event.dataTransfer.effectAllowed = "move";
		},
		[node.path],
	);

	const handleDragOver = React.useCallback(
		(event: React.DragEvent) => {
			if (!isDirectory) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
		},
		[isDirectory],
	);

	const handleDrop = React.useCallback(
		(event: React.DragEvent) => {
			event.preventDefault();
			const sourcePath = event.dataTransfer.getData("text/plain");
			if (!sourcePath || sourcePath === node.path) return;
			if (node.path.startsWith(`${sourcePath}/`)) return;

			const targetDir = isDirectory ? node.path : node.parentPath;
			if (targetDir && sourcePath !== targetDir) {
				void onMoveNode(sourcePath, targetDir);
			}
		},
		[isDirectory, node.parentPath, node.path, onMoveNode],
	);

	const visibleChildren = React.useMemo(() => {
		if (!isDirectory || !node.children) return [];
		return node.children.filter((child) => {
			if (isHidden(child.name)) return false;
			if (filter && !matchesFilter(child, filter)) return false;
			return true;
		});
	}, [isDirectory, node.children, filter]);

	return (
		<div>
			<div
				className={`group flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
					isActiveFile
						? "bg-sky-500/15 text-sky-100"
						: isSelected
							? "bg-sky-500/10 text-sky-100"
							: "text-foreground/85 hover:bg-panel-600"
				}`}
				style={{ paddingLeft: `${depth * 14 + 8}px` }}
				draggable={!!node.parentPath}
				onDragStart={handleDragStart}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				{isRenaming ? (
					<div className="flex min-w-0 flex-1 items-center gap-2">
						<span className="flex h-4 w-4 items-center justify-center text-foreground/50">
							{isDirectory ? (
								isExpanded ? (
									<ChevronDown className="h-4 w-4" />
								) : (
									<ChevronRight className="h-4 w-4" />
								)
							) : null}
						</span>
						{isDirectory ? (
							isExpanded ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />
						) : (
							fileIcon ? <FileIcon fileName={node.name} /> : <span className="h-4 w-4 shrink-0" />
						)}
						<InlineNameForm
							initialValue={node.name}
							label="Rename"
							onCancel={onCancelInlineState}
							onSubmit={onRenameNode}
						/>
					</div>
				) : (
					<button
						type="button"
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
						onClick={() => void onOpenNode(node)}
						onContextMenu={(event) => {
							event.preventDefault();
							onOpenContextMenu(node, event.clientX, event.clientY);
						}}
						onKeyDown={(event) => {
							if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
								event.preventDefault();
								const rect = event.currentTarget.getBoundingClientRect();
								onOpenContextMenu(node, rect.left + 12, rect.bottom + 4);
							}
						}}
					>
						<span className="flex h-4 w-4 items-center justify-center text-foreground/50">
							{isDirectory ? (
								isExpanded ? (
									<ChevronDown className="h-4 w-4" />
								) : (
									<ChevronRight className="h-4 w-4" />
								)
							) : null}
						</span>
						{isDirectory ? (
							isExpanded ? (
								<FolderOpen className={`h-4 w-4 shrink-0 ${dirGitStatus ? GIT_STATUS_COLORS[dirGitStatus] : ""}`} />
							) : (
								<Folder className={`h-4 w-4 shrink-0 ${dirGitStatus ? GIT_STATUS_COLORS[dirGitStatus] : ""}`} />
							)
						) : (
							<FileIcon fileName={node.name} />
						)}
						<span className={`min-w-0 flex-1 truncate ${gitColorClass}`}>{node.name}</span>
						{fileGitStatus ? (
							<span className={`ml-auto shrink-0 text-[10px] font-semibold ${GIT_STATUS_COLORS[fileGitStatus]}`}>
								{GIT_STATUS_LABELS[fileGitStatus]}
							</span>
						) : null}
						{!node.permissions.write ? (
							<span className="rounded border border-border-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/45">
								Read only
							</span>
						) : null}
					</button>
				)}
			</div>

			{isDirectory && isExpanded ? (
				<div>
					{node.isLoading ? (
						<div
							className="px-2 py-1 text-xs text-foreground/45"
							style={{ paddingLeft: `${(depth + 1) * 14 + 36}px` }}
						>
							Loading...
						</div>
					) : null}
					{visibleChildren.map((child) => (
						<ProjectTree
							key={child.path}
							depth={depth + 1}
							expandedPaths={expandedPaths}
							filter={filter}
							gitStatus={gitStatus}
							node={child}
							activeFilePath={activeFilePath}
							onBeginCreate={onBeginCreate}
							onBeginRename={onBeginRename}
							onCancelInlineState={onCancelInlineState}
							onCreateNode={onCreateNode}
							onDeleteNode={onDeleteNode}
							onMoveNode={onMoveNode}
							onOpenNode={onOpenNode}
							onRenameNode={onRenameNode}
							onSelectNode={onSelectNode}
							onOpenContextMenu={onOpenContextMenu}
							pendingCreate={pendingCreate}
							renamingPath={renamingPath}
							selectedPath={selectedPath}
						/>
					))}
					{showInlineCreate ? (
						<div
							className="px-2 py-1"
							style={{ paddingLeft: `${(depth + 1) * 14 + 36}px` }}
						>
							<InlineNameForm
								initialValue={
									pendingCreate.kind === "file" ? "untitled.tsx" : "new-folder"
								}
								label={
									pendingCreate.kind === "file" ? "New file name" : "New folder name"
								}
								onCancel={onCancelInlineState}
								onSubmit={onCreateNode}
							/>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function Sidebar({
	className,
	error,
	expandedPaths,
	gitStatus,
	isBusy,
	activeFilePath,
	onBeginCreate,
	onBeginRename,
	onCancelInlineState,
	onCreateNode,
	onDeleteNode,
	onMoveNode,
	onOpenNode,
	onOpenProjectFolder,
	onRefresh,
	onRenameNode,
	onRevealPath,
	onSelectNode,
	pendingCreate,
	project,
	renamingPath,
	selectedPath,
}: SidebarProps) {
	const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
	const [filter, setFilter] = React.useState("");
	const [showSearch, setShowSearch] = React.useState(false);
	const searchInputRef = React.useRef<HTMLInputElement>(null);
	const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
	const canRenameOrDelete = Boolean(
		contextMenu?.node && contextMenu.node.parentPath,
	);

	React.useEffect(() => {
		injectSetiFont();
	}, []);

	React.useEffect(() => {
		if (activeFilePath && project) {
			onRevealPath(activeFilePath);
		}
	}, [activeFilePath, onRevealPath, project]);

	React.useEffect(() => {
		if (showSearch) {
			searchInputRef.current?.focus();
		} else {
			setFilter("");
		}
	}, [showSearch]);

	React.useEffect(() => {
		if (!contextMenu) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (contextMenuRef.current?.contains(event.target as Node)) {
				return;
			}
			setContextMenu(null);
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setContextMenu(null);
			}
		};

		window.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("resize", handleEscape as unknown as EventListener);
		window.addEventListener("keydown", handleEscape);

		return () => {
			window.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("resize", handleEscape as unknown as EventListener);
			window.removeEventListener("keydown", handleEscape);
		};
	}, [contextMenu]);

	const openContextMenu = React.useCallback(
		async (node: ProjectNode, x: number, y: number) => {
			onSelectNode(node);
			const nativeContextMenu = window.nativeContextMenu;
			if (nativeContextMenu) {
				const actionId = await nativeContextMenu.showMenu({
					items: buildContextMenuItems(node),
					x,
					y,
				});
				if (actionId) {
					switch (actionId) {
						case "new-file":
							onBeginCreate("file", node.path);
							break;
						case "new-folder":
							onBeginCreate("directory", node.path);
							break;
						case "rename":
							onBeginRename(node.path);
							break;
						case "delete":
							if (window.confirm(`Delete "${node.name}"?`)) {
								void onDeleteNode(node.path);
							}
							break;
						default:
							break;
					}
				}
				return;
			}

			setContextMenu({ node, x, y });
		},
		[onBeginCreate, onBeginRename, onDeleteNode, onSelectNode],
	);

	const closeContextMenu = React.useCallback(() => {
		setContextMenu(null);
	}, []);

	const runMenuAction = React.useCallback(
		(action: () => void | Promise<void>) => {
			closeContextMenu();
			void action();
		},
		[closeContextMenu],
	);

	const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 210) : 0;
	const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 220) : 0;

	return (
		<div
			className={`flex h-full flex-col rounded-[16px] bg-panel ${className ?? ""}`}
		>
			<div className="flex items-center justify-between border-b border-border-500 px-4 py-3">
				<div className="min-w-0">
					<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/45">
						Project
					</div>
					<div className="truncate text-sm font-medium text-foreground">
						{project
							? project.roots.length === 1
								? project.roots[0]?.name
								: `${project.roots.length} workspace folders`
							: "No folder opened"}
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8"
						aria-label="Open project folder"
						onClick={() => void onOpenProjectFolder()}
					>
						<FolderOpen className="h-4 w-4" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8"
						aria-label="New file"
						disabled={!project}
						onClick={() => onBeginCreate("file", selectedPath ?? project?.roots[0]?.path)}
					>
						<FilePlus className="h-4 w-4" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8"
						aria-label="New folder"
						disabled={!project}
						onClick={() =>
							onBeginCreate("directory", selectedPath ?? project?.roots[0]?.path)
						}
					>
						<FolderPlus className="h-4 w-4" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8"
						aria-label="Search files"
						disabled={!project}
						onClick={() => setShowSearch((s) => !s)}
					>
						<Search className="h-4 w-4" />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8"
						aria-label="Refresh project"
						disabled={!project || isBusy}
						onClick={() => void onRefresh()}
					>
						<RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
					</Button>
				</div>
			</div>

			{showSearch ? (
				<div className="flex items-center gap-2 border-b border-border-500 px-3 py-2">
					<Search className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
					<input
						ref={searchInputRef}
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								setShowSearch(false);
							}
						}}
						className="h-6 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35"
						placeholder="Filter files..."
					/>
					{filter ? (
						<button
							type="button"
							onClick={() => setFilter("")}
							className="shrink-0 text-foreground/40 hover:text-foreground/70"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					) : null}
				</div>
			) : null}

			{error ? (
				<div className="border-b border-border-500 bg-destructive/10 px-4 py-2 text-xs text-foreground/80">
					{error}
				</div>
			) : null}

			<div className="min-h-0 flex-1 overflow-auto px-2 py-3">
				{project ? (
					project.roots.map((root) => (
						<ProjectTree
							key={root.path}
							expandedPaths={expandedPaths}
							filter={filter}
							gitStatus={gitStatus}
							node={root}
							activeFilePath={activeFilePath}
							onBeginCreate={onBeginCreate}
							onBeginRename={onBeginRename}
							onCancelInlineState={onCancelInlineState}
							onCreateNode={onCreateNode}
							onDeleteNode={onDeleteNode}
							onMoveNode={onMoveNode}
							onOpenNode={onOpenNode}
							onRenameNode={onRenameNode}
							onSelectNode={onSelectNode}
							onOpenContextMenu={openContextMenu}
							pendingCreate={pendingCreate}
							renamingPath={renamingPath}
							selectedPath={selectedPath}
						/>
					))
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
						<div className="rounded-full border border-border-500 bg-panel-600 p-3">
							<FolderOpen className="h-6 w-6 text-foreground/75" />
						</div>
						<div>
							<div className="text-sm font-medium text-foreground">
								Open a project folder
							</div>
							<div className="mt-1 text-xs leading-5 text-foreground/55">
								Load an initial folder to browse, create, rename, edit, and delete
								files from the sidebar.
							</div>
						</div>
						<Button onClick={() => void onOpenProjectFolder()}>
							Open Project Folder
						</Button>
					</div>
				)}
			</div>

			{contextMenu ? (
				<div
					ref={contextMenuRef}
					className="fixed z-50 min-w-[180px] rounded-md border border-border-500 bg-panel-600 p-1 shadow-2xl"
					style={{ left: `${menuX}px`, top: `${menuY}px` }}
				>
					{contextMenu.node.kind === "directory" ? (
						<>
							<button
								type="button"
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground/85 hover:bg-panel-500"
								onClick={() =>
									runMenuAction(() => onBeginCreate("file", contextMenu.node.path))
								}
							>
								<FilePlus className="h-4 w-4" />
								New File
							</button>
							<button
								type="button"
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground/85 hover:bg-panel-500"
								onClick={() =>
									runMenuAction(() =>
										onBeginCreate("directory", contextMenu.node.path),
									)
								}
							>
								<FolderPlus className="h-4 w-4" />
								New Folder
							</button>
						</>
					) : null}

					{canRenameOrDelete ? (
						<>
							<div className="my-1 border-t border-border-500" />
							<button
								type="button"
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground/85 hover:bg-panel-500"
								onClick={() =>
									runMenuAction(() => onBeginRename(contextMenu.node.path))
								}
							>
								<Pencil className="h-4 w-4" />
								Rename
							</button>
							<button
								type="button"
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive-foreground/80 hover:bg-panel-500 hover:text-destructive-foreground"
								onClick={() =>
									runMenuAction(() => {
										if (window.confirm(`Delete "${contextMenu.node.name}"?`)) {
											return onDeleteNode(contextMenu.node.path);
										}
									})
								}
							>
								<Trash2 className="h-4 w-4" />
								Delete
							</button>
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}
