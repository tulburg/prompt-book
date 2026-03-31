import {
	ArrowUpDown,
	ChevronDown,
	ChevronRight,
	Copy,
	FilePlus,
	FolderOpen,
	FolderPlus,
	Pencil,
	RefreshCw,
	Search,
	Trash2,
	X,
} from "lucide-react";
import * as React from "react";
import { injectSetiFont, resolveFileIcon, toSetiGlyph } from "@/extensions/theme-seti/file-icons";
import type { NativeContextMenuItem } from "@/lib/native-context-menu";
import type { GitFileStatus, GitStatusMap, ProjectNode, ProjectNodeKind, ProjectSnapshot } from "@/lib/project-files";
import {
	buildSidebarTree,
	flattenSidebarTree,
	matchesViewPath,
	type SidebarSortOrder,
	type SidebarViewNode,
} from "@/lib/sidebar-tree";
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
const SORT_ORDER_STORAGE_KEY = "prompt-book-sidebar-sort-order";
const TREE_INDENT_PX = 7;
const SORT_OPTIONS: Array<{ value: SidebarSortOrder; label: string }> = [
	{ value: "default", label: "Default" },
	{ value: "files-first", label: "Files First" },
	{ value: "type", label: "Type" },
	{ value: "modified", label: "Modified" },
];

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
	if (node.kind !== "directory") {
		return null;
	}

	const prefix = node.path.endsWith("/") ? node.path : `${node.path}/`;
	return Object.keys(gitStatus).some((path) => path.startsWith(prefix))
		? "modified"
		: null;
}

function FileIcon({ fileName }: { fileName: string }) {
	const icon = resolveFileIcon(fileName, false);
	if (!icon) {
		return null;
	}

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
	onCopyNode: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>;
	onBeginRename: (targetPath: string) => void;
	onRenameNode: (name: string) => void | Promise<void>;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onMoveNode: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>;
	onCancelInlineState: () => void;
	onSelectNode: (node: ProjectNode) => void;
	onRevealPath: (targetPath: string) => void;
}

interface ContextMenuState {
	node: SidebarViewNode;
	x: number;
	y: number;
}

function getPasteTargetDirectory(node: SidebarViewNode | null) {
	if (!node) {
		return null;
	}

	return node.kind === "directory" ? node.path : node.parentPath;
}

function buildContextMenuItems(
	node: SidebarViewNode,
	hasClipboard: boolean,
): NativeContextMenuItem[] {
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

		if (hasClipboard) {
			items.push({
				type: "action",
				id: "paste",
				label: "Paste",
				accelerator: "CmdOrCtrl+V",
			});
		}
	}

	if (node.node.parentPath) {
		if (items.length > 0) {
			items.push({ type: "separator" });
		}
		items.push(
			{ type: "action", id: "copy", label: "Copy", accelerator: "CmdOrCtrl+C" },
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
	node,
	depth = 0,
	activeFilePath,
	expandedNestedPaths,
	expandedPaths,
	gitStatus,
	onBeginCreate,
	onBeginRename,
	onCancelInlineState,
	onCreateNode,
	onDeleteNode,
	onFocusTree,
	onMoveNode,
	onOpenNode,
	onOpenContextMenu,
	onRenameNode,
	onSelectNode,
	onToggleNestedPath,
	pendingCreate,
	renamingPath,
	selectedPath,
}: {
	node: SidebarViewNode;
	depth?: number;
	activeFilePath: string | null;
	expandedNestedPaths: ReadonlySet<string>;
	expandedPaths: ReadonlySet<string>;
	gitStatus: GitStatusMap;
	onBeginCreate: (kind: ProjectNodeKind, targetPath?: string) => void;
	onBeginRename: (targetPath: string) => void;
	onCancelInlineState: () => void;
	onCreateNode: (name: string) => void | Promise<void>;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onFocusTree: () => void;
	onMoveNode: (sourcePath: string, targetDirectoryPath: string) => void | Promise<void>;
	onOpenNode: (node: ProjectNode) => void | Promise<void>;
	onOpenContextMenu: (node: SidebarViewNode, x: number, y: number) => void;
	onRenameNode: (name: string) => void | Promise<void>;
	onSelectNode: (node: ProjectNode) => void;
	onToggleNestedPath: (targetPath: string) => void;
	pendingCreate: PendingCreateState | null;
	renamingPath: string | null;
	selectedPath: string | null;
}) {
	const isDirectory = node.kind === "directory";
	const isExpanded = expandedPaths.has(node.path);
	const isSelected = matchesViewPath(node, selectedPath);
	const isActiveFile = activeFilePath === node.path;
	const isRenaming = renamingPath === node.path;
	const showInlineCreate = pendingCreate?.parentPath === node.path && isDirectory;
	const hasNestedChildren = node.nestedChildren.length > 0;
	const isNestedExpanded = expandedNestedPaths.has(node.path);

	const fileGitStatus = gitStatus[node.path] as GitFileStatus | undefined;
	const dirGitStatus = isDirectory ? getDirectoryGitStatus(node.node, gitStatus) : null;
	const effectiveGitStatus = fileGitStatus ?? dirGitStatus;
	const gitColorClass = effectiveGitStatus ? GIT_STATUS_COLORS[effectiveGitStatus] : "";

	const handleDragStart = React.useCallback(
		(event: React.DragEvent) => {
			event.dataTransfer.setData("text/plain", node.path);
			event.dataTransfer.effectAllowed = "move";
		},
		[node.path],
	);

	const handleDragOver = React.useCallback(
		(event: React.DragEvent) => {
			if (!isDirectory) {
				return;
			}

			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
		},
		[isDirectory],
	);

	const handleDrop = React.useCallback(
		(event: React.DragEvent) => {
			event.preventDefault();
			const sourcePath = event.dataTransfer.getData("text/plain");
			if (!sourcePath || sourcePath === node.path || node.path.startsWith(`${sourcePath}/`)) {
				return;
			}

			const targetDirectoryPath = isDirectory ? node.path : node.parentPath;
			if (targetDirectoryPath && targetDirectoryPath !== sourcePath) {
				void onMoveNode(sourcePath, targetDirectoryPath);
			}
		},
		[isDirectory, node.parentPath, node.path, onMoveNode],
	);

	const renderLeadingToggle = () => {
		if (!isDirectory && !hasNestedChildren) {
			return <span className="flex h-4 w-4 shrink-0" />;
		}

		const expanded = isDirectory ? isExpanded : isNestedExpanded;
		return (
			<button
				type="button"
				className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground/50"
				onClick={(event) => {
					event.stopPropagation();
					onFocusTree();
					if (isDirectory) {
						onSelectNode(node.node);
						void onOpenNode(node.node);
						return;
					}
					onToggleNestedPath(node.path);
				}}
				tabIndex={-1}
			>
				{expanded ? (
					<ChevronDown className="h-4 w-4" />
				) : (
					<ChevronRight className="h-4 w-4" />
				)}
			</button>
		);
	};

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
				style={{ paddingLeft: `${depth * TREE_INDENT_PX + 8}px` }}
				draggable={!!node.node.parentPath}
				onDragStart={handleDragStart}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				{isRenaming ? (
					<div className="flex min-w-0 flex-1 items-center gap-2">
						{renderLeadingToggle()}
						{!isDirectory ? (
							<FileIcon fileName={node.name} />
						) : null}
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
						className={`flex min-w-0 flex-1 items-center ${isDirectory ? "gap-0.5" : "gap-1"} text-left`}
						onMouseDown={onFocusTree}
						onClick={() => {
							onSelectNode(node.node);
							void onOpenNode(node.node);
						}}
						onContextMenu={(event) => {
							event.preventDefault();
							onFocusTree();
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
						{renderLeadingToggle()}
						{!isDirectory ? (
							<FileIcon fileName={node.name} />
						) : null}
						<span
							className={`min-w-0 flex-1 truncate ${
								isDirectory && dirGitStatus ? GIT_STATUS_COLORS[dirGitStatus] : gitColorClass
							}`}
						>
							{node.displayName}
						</span>
						{fileGitStatus ? (
							<span className={`ml-auto shrink-0 text-[10px] font-semibold ${GIT_STATUS_COLORS[fileGitStatus]}`}>
								{GIT_STATUS_LABELS[fileGitStatus]}
							</span>
						) : null}
						{!node.node.permissions.write ? (
							<span className="rounded border border-border-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/45">
								Read only
							</span>
						) : null}
					</button>
				)}
			</div>

			{isDirectory && isExpanded ? (
				<div>
					{node.node.isLoading ? (
						<div
							className="px-2 py-1 text-xs text-foreground/45"
							style={{ paddingLeft: `${(depth + 1) * TREE_INDENT_PX + 36}px` }}
						>
							Loading...
						</div>
					) : null}
					{node.children.map((child) => (
						<ProjectTree
							key={child.path}
							node={child}
							depth={depth + 1}
							activeFilePath={activeFilePath}
							expandedNestedPaths={expandedNestedPaths}
							expandedPaths={expandedPaths}
							gitStatus={gitStatus}
							onBeginCreate={onBeginCreate}
							onBeginRename={onBeginRename}
							onCancelInlineState={onCancelInlineState}
							onCreateNode={onCreateNode}
							onDeleteNode={onDeleteNode}
							onFocusTree={onFocusTree}
							onMoveNode={onMoveNode}
							onOpenNode={onOpenNode}
							onOpenContextMenu={onOpenContextMenu}
							onRenameNode={onRenameNode}
							onSelectNode={onSelectNode}
							onToggleNestedPath={onToggleNestedPath}
							pendingCreate={pendingCreate}
							renamingPath={renamingPath}
							selectedPath={selectedPath}
						/>
					))}
					{showInlineCreate ? (
						<div
							className="px-2 py-1"
							style={{ paddingLeft: `${(depth + 1) * TREE_INDENT_PX + 36}px` }}
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

			{hasNestedChildren && isNestedExpanded ? (
				<div>
					{node.nestedChildren.map((child) => (
						<ProjectTree
							key={child.path}
							node={child}
							depth={depth + 1}
							activeFilePath={activeFilePath}
							expandedNestedPaths={expandedNestedPaths}
							expandedPaths={expandedPaths}
							gitStatus={gitStatus}
							onBeginCreate={onBeginCreate}
							onBeginRename={onBeginRename}
							onCancelInlineState={onCancelInlineState}
							onCreateNode={onCreateNode}
							onDeleteNode={onDeleteNode}
							onFocusTree={onFocusTree}
							onMoveNode={onMoveNode}
							onOpenNode={onOpenNode}
							onOpenContextMenu={onOpenContextMenu}
							onRenameNode={onRenameNode}
							onSelectNode={onSelectNode}
							onToggleNestedPath={onToggleNestedPath}
							pendingCreate={pendingCreate}
							renamingPath={renamingPath}
							selectedPath={selectedPath}
						/>
					))}
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
	onCopyNode,
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
	const [expandedNestedPaths, setExpandedNestedPaths] = React.useState<Set<string>>(new Set());
	const [filter, setFilter] = React.useState("");
	const [showSearch, setShowSearch] = React.useState(false);
	const [clipboardPath, setClipboardPath] = React.useState<string | null>(null);
	const [sortOrder, setSortOrder] = React.useState<SidebarSortOrder>(() => {
		if (typeof window === "undefined") {
			return "default";
		}

		const storedValue = window.localStorage.getItem(SORT_ORDER_STORAGE_KEY);
		return SORT_OPTIONS.some((option) => option.value === storedValue)
			? (storedValue as SidebarSortOrder)
			: "default";
	});
	const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
	const searchInputRef = React.useRef<HTMLInputElement>(null);
	const treeRef = React.useRef<HTMLDivElement>(null);
	const typeaheadRef = React.useRef<number | null>(null);
	const typeaheadBufferRef = React.useRef("");

	const treeNodes = React.useMemo(
		() =>
			buildSidebarTree(project?.roots ?? [], {
				enableCompactFolders: true,
				enableFileNesting: true,
				filter,
				hiddenEntries: HIDDEN_ENTRIES,
				sortOrder,
			}),
		[filter, project?.roots, sortOrder],
	);
	const flatEntries = React.useMemo(
		() => flattenSidebarTree(treeNodes, expandedPaths, expandedNestedPaths),
		[expandedNestedPaths, expandedPaths, treeNodes],
	);
	const selectedEntryIndex = React.useMemo(
		() => flatEntries.findIndex((entry) => matchesViewPath(entry.node, selectedPath)),
		[flatEntries, selectedPath],
	);
	const canRenameOrDelete = Boolean(contextMenu?.node && contextMenu.node.node.parentPath);

	const focusTree = React.useCallback(() => {
		treeRef.current?.focus();
	}, []);

	const toggleNestedPath = React.useCallback((targetPath: string) => {
		setExpandedNestedPaths((current) => {
			const next = new Set(current);
			if (next.has(targetPath)) {
				next.delete(targetPath);
			} else {
				next.add(targetPath);
			}
			return next;
		});
	}, []);

	const pasteIntoTarget = React.useCallback(
		async (targetNode: SidebarViewNode | null) => {
			const targetDirectoryPath = getPasteTargetDirectory(targetNode);
			if (!clipboardPath || !targetDirectoryPath) {
				return;
			}

			await onCopyNode(clipboardPath, targetDirectoryPath);
		},
		[clipboardPath, onCopyNode],
	);

	React.useEffect(() => {
		injectSetiFont();
	}, []);

	React.useEffect(() => {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, sortOrder);
		}
	}, [sortOrder]);

	React.useEffect(() => {
		if (activeFilePath && project) {
			onRevealPath(activeFilePath);
		}
	}, [activeFilePath, onRevealPath, project]);

	React.useEffect(() => {
		if (showSearch) {
			searchInputRef.current?.focus();
			return;
		}

		setFilter("");
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
		window.addEventListener("keydown", handleEscape);

		return () => {
			window.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("keydown", handleEscape);
		};
	}, [contextMenu]);

	const openContextMenu = React.useCallback(
		async (node: SidebarViewNode, x: number, y: number) => {
			onSelectNode(node.node);
			focusTree();

			const nativeContextMenu = window.nativeContextMenu;
			if (nativeContextMenu) {
				const actionId = await nativeContextMenu.showMenu({
					items: buildContextMenuItems(node, Boolean(clipboardPath)),
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
						case "copy":
							setClipboardPath(node.path);
							break;
						case "paste":
							void pasteIntoTarget(node);
							break;
						case "rename":
							onBeginRename(node.path);
							break;
						case "delete":
							if (window.confirm(`Delete "${node.displayName}"?`)) {
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
		[
			clipboardPath,
			focusTree,
			onBeginCreate,
			onBeginRename,
			onDeleteNode,
			onSelectNode,
			pasteIntoTarget,
		],
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

	const handleTreeKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (!flatEntries.length) {
				return;
			}

			const currentIndex = selectedEntryIndex >= 0 ? selectedEntryIndex : 0;
			const currentEntry = flatEntries[currentIndex];
			const key = event.key;
			const isMeta = event.metaKey || event.ctrlKey;

			if (isMeta && key.toLowerCase() === "f") {
				event.preventDefault();
				setShowSearch(true);
				return;
			}

			if (isMeta && key.toLowerCase() === "c") {
				if (currentEntry?.node.node.parentPath) {
					event.preventDefault();
					setClipboardPath(currentEntry.node.path);
				}
				return;
			}

			if (isMeta && key.toLowerCase() === "v") {
				event.preventDefault();
				void pasteIntoTarget(currentEntry?.node ?? null);
				return;
			}

			if (!currentEntry) {
				return;
			}

			if (key === "ArrowDown") {
				event.preventDefault();
				const nextEntry = flatEntries[Math.min(currentIndex + 1, flatEntries.length - 1)];
				if (nextEntry) {
					onSelectNode(nextEntry.node.node);
				}
				return;
			}

			if (key === "ArrowUp") {
				event.preventDefault();
				const nextEntry = flatEntries[Math.max(currentIndex - 1, 0)];
				if (nextEntry) {
					onSelectNode(nextEntry.node.node);
				}
				return;
			}

			if (key === "ArrowRight") {
				event.preventDefault();
				if (currentEntry.node.kind === "directory") {
					if (!expandedPaths.has(currentEntry.node.path) && currentEntry.node.children.length > 0) {
						void onOpenNode(currentEntry.node.node);
						return;
					}

					const firstChild = flatEntries.find(
						(entry) => entry.parentPath === currentEntry.node.path,
					);
					if (firstChild) {
						onSelectNode(firstChild.node.node);
					}
					return;
				}

				if (currentEntry.node.nestedChildren.length > 0) {
					if (!expandedNestedPaths.has(currentEntry.node.path)) {
						toggleNestedPath(currentEntry.node.path);
						return;
					}

					const firstChild = flatEntries.find(
						(entry) => entry.parentPath === currentEntry.node.path,
					);
					if (firstChild) {
						onSelectNode(firstChild.node.node);
					}
				}
				return;
			}

			if (key === "ArrowLeft") {
				event.preventDefault();
				if (
					currentEntry.node.kind === "directory" &&
					expandedPaths.has(currentEntry.node.path)
				) {
					void onOpenNode(currentEntry.node.node);
					return;
				}

				if (
					currentEntry.node.nestedChildren.length > 0 &&
					expandedNestedPaths.has(currentEntry.node.path)
				) {
					toggleNestedPath(currentEntry.node.path);
					return;
				}

				if (currentEntry.parentPath) {
					const parentEntry = flatEntries.find(
						(entry) => entry.node.path === currentEntry.parentPath,
					);
					if (parentEntry) {
						onSelectNode(parentEntry.node.node);
					}
				}
				return;
			}

			if (key === "Enter" || key === " ") {
				event.preventDefault();
				void onOpenNode(currentEntry.node.node);
				return;
			}

			if (key === "Home") {
				event.preventDefault();
				onSelectNode(flatEntries[0].node.node);
				return;
			}

			if (key === "End") {
				event.preventDefault();
				onSelectNode(flatEntries[flatEntries.length - 1].node.node);
				return;
			}

			if (
				key.length === 1 &&
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey
			) {
				const nextBuffer = `${typeaheadBufferRef.current}${key.toLowerCase()}`;
				typeaheadBufferRef.current = nextBuffer;
				if (typeaheadRef.current) {
					window.clearTimeout(typeaheadRef.current);
				}
				typeaheadRef.current = window.setTimeout(() => {
					typeaheadBufferRef.current = "";
					typeaheadRef.current = null;
				}, 500);

				for (let offset = 1; offset <= flatEntries.length; offset += 1) {
					const index = (currentIndex + offset) % flatEntries.length;
					const candidate = flatEntries[index];
					if (candidate.node.displayName.toLowerCase().startsWith(nextBuffer)) {
						onSelectNode(candidate.node.node);
						break;
					}
				}
			}
		},
		[
			expandedNestedPaths,
			expandedPaths,
			flatEntries,
			onOpenNode,
			onSelectNode,
			pasteIntoTarget,
			selectedEntryIndex,
			toggleNestedPath,
		],
	);

	const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 210) : 0;
	const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 240) : 0;

	return (
		<div className={`flex h-full flex-col rounded-[16px] bg-panel ${className ?? ""}`}>
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
						onClick={() => setShowSearch((current) => !current)}
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

			<div className="flex items-center gap-2 border-b border-border-500 px-3 py-2">
				{showSearch && (
					<>
						<Search className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
						<input
							ref={searchInputRef}
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									setShowSearch(false);
								}
							}}
							className="h-6 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35"
							placeholder="Filter files..."
						/>
						<button
							type="button"
							onClick={() => {
								setFilter("");
								setShowSearch(false);
							}}
							className="shrink-0 text-foreground/40 hover:text-foreground/70"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</>
				)}
			</div>

			{error ? (
				<div className="border-b border-border-500 bg-destructive/10 px-4 py-2 text-xs text-foreground/80">
					{error}
				</div>
			) : null}

			<div
				ref={treeRef}
				className="min-h-0 flex-1 overflow-auto px-2 py-3 outline-none"
				tabIndex={0}
				onKeyDown={handleTreeKeyDown}
			>
				{project ? (
					treeNodes.map((root) => (
						<ProjectTree
							key={root.path}
							node={root}
							activeFilePath={activeFilePath}
							expandedNestedPaths={expandedNestedPaths}
							expandedPaths={expandedPaths}
							gitStatus={gitStatus}
							onBeginCreate={onBeginCreate}
							onBeginRename={onBeginRename}
							onCancelInlineState={onCancelInlineState}
							onCreateNode={onCreateNode}
							onDeleteNode={onDeleteNode}
							onFocusTree={focusTree}
							onMoveNode={onMoveNode}
							onOpenNode={onOpenNode}
							onOpenContextMenu={openContextMenu}
							onRenameNode={onRenameNode}
							onSelectNode={onSelectNode}
							onToggleNestedPath={toggleNestedPath}
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
							{clipboardPath ? (
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground/85 hover:bg-panel-500"
									onClick={() => runMenuAction(() => pasteIntoTarget(contextMenu.node))}
								>
									<Copy className="h-4 w-4" />
									Paste
								</button>
							) : null}
						</>
					) : null}

					{canRenameOrDelete ? (
						<>
							<div className="my-1 border-t border-border-500" />
							<button
								type="button"
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-foreground/85 hover:bg-panel-500"
								onClick={() =>
									runMenuAction(() => {
										setClipboardPath(contextMenu.node.path);
									})
								}
							>
								<Copy className="h-4 w-4" />
								Copy
							</button>
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
										if (window.confirm(`Delete "${contextMenu.node.displayName}"?`)) {
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
