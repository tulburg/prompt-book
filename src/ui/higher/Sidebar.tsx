import {
	ChevronDown,
	ChevronRight,
	File,
	FilePlus,
	Folder,
	FolderOpen,
	FolderPlus,
	Pencil,
	RefreshCw,
	Trash2,
} from "lucide-react";
import * as React from "react";
import type { ProjectNode, ProjectNodeKind, ProjectSnapshot } from "@/lib/project-files";
import { Button } from "@/ui/lower/Button";

interface PendingCreateState {
	parentPath: string;
	kind: ProjectNodeKind;
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
	project: ProjectSnapshot | null;
	selectedPath: string | null;
	expandedPaths: Set<string>;
	pendingCreate: PendingCreateState | null;
	renamingPath: string | null;
	isBusy: boolean;
	error: string | null;
	onOpenProjectFolder: () => void | Promise<void>;
	onRefresh: () => void | Promise<void>;
	onOpenNode: (node: ProjectNode) => void | Promise<void>;
	onBeginCreate: (kind: ProjectNodeKind, targetPath?: string) => void;
	onCreateNode: (name: string) => void | Promise<void>;
	onBeginRename: (targetPath: string) => void;
	onRenameNode: (name: string) => void | Promise<void>;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onCancelInlineState: () => void;
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
	node,
	onBeginCreate,
	onBeginRename,
	onCancelInlineState,
	onCreateNode,
	onDeleteNode,
	onOpenNode,
	onRenameNode,
	pendingCreate,
	renamingPath,
	selectedPath,
}: {
	depth?: number;
	expandedPaths: Set<string>;
	node: ProjectNode;
	onBeginCreate: (kind: ProjectNodeKind, targetPath?: string) => void;
	onBeginRename: (targetPath: string) => void;
	onCancelInlineState: () => void;
	onCreateNode: (name: string) => void | Promise<void>;
	onDeleteNode: (targetPath: string) => void | Promise<void>;
	onOpenNode: (node: ProjectNode) => void | Promise<void>;
	onRenameNode: (name: string) => void | Promise<void>;
	pendingCreate: PendingCreateState | null;
	renamingPath: string | null;
	selectedPath: string | null;
}) {
	const isDirectory = node.kind === "directory";
	const isExpanded = expandedPaths.has(node.path);
	const isSelected = selectedPath === node.path;
	const isRoot = depth === 0;
	const isRenaming = renamingPath === node.path;
	const showInlineCreate = pendingCreate?.parentPath === node.path && isDirectory;
	const Icon = isDirectory ? (isExpanded ? FolderOpen : Folder) : File;

	return (
		<div>
			<div
				className={`group flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
					isSelected ? "bg-sky-500/10 text-sky-100" : "text-foreground/85 hover:bg-panel-600"
				}`}
				style={{ paddingLeft: `${depth * 14 + 8}px` }}
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
						<Icon className="h-4 w-4 shrink-0" />
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
						<Icon className="h-4 w-4 shrink-0" />
						<span className="truncate">{node.name}</span>
						{!node.permissions.write ? (
							<span className="rounded border border-border-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground/45">
								Read only
							</span>
						) : null}
					</button>
				)}

				{!isRenaming ? (
					<div
						className={`flex items-center gap-1 ${
							isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
						}`}
					>
						{isDirectory ? (
							<>
								<Button
									size="icon"
									variant="ghost"
									className="h-6 w-6"
									aria-label={`Create file in ${node.name}`}
									onClick={(event) => {
										event.stopPropagation();
										onBeginCreate("file", node.path);
									}}
								>
									<FilePlus className="h-3.5 w-3.5" />
								</Button>
								<Button
									size="icon"
									variant="ghost"
									className="h-6 w-6"
									aria-label={`Create folder in ${node.name}`}
									onClick={(event) => {
										event.stopPropagation();
										onBeginCreate("directory", node.path);
									}}
								>
									<FolderPlus className="h-3.5 w-3.5" />
								</Button>
							</>
						) : null}
						{!isRoot ? (
							<>
								<Button
									size="icon"
									variant="ghost"
									className="h-6 w-6"
									aria-label={`Rename ${node.name}`}
									onClick={(event) => {
										event.stopPropagation();
										onBeginRename(node.path);
									}}
								>
									<Pencil className="h-3.5 w-3.5" />
								</Button>
								<Button
									size="icon"
									variant="ghost"
									className="h-6 w-6 text-destructive-foreground/80 hover:text-destructive-foreground"
									aria-label={`Delete ${node.name}`}
									onClick={(event) => {
										event.stopPropagation();
										if (window.confirm(`Delete "${node.name}"?`)) {
											void onDeleteNode(node.path);
										}
									}}
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</>
						) : null}
					</div>
				) : null}
			</div>

			{isDirectory && isExpanded ? (
				<div>
					{node.children?.map((child) => (
						<ProjectTree
							key={child.path}
							depth={depth + 1}
							expandedPaths={expandedPaths}
							node={child}
							onBeginCreate={onBeginCreate}
							onBeginRename={onBeginRename}
							onCancelInlineState={onCancelInlineState}
							onCreateNode={onCreateNode}
							onDeleteNode={onDeleteNode}
							onOpenNode={onOpenNode}
							onRenameNode={onRenameNode}
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
	isBusy,
	onBeginCreate,
	onBeginRename,
	onCancelInlineState,
	onCreateNode,
	onDeleteNode,
	onOpenNode,
	onOpenProjectFolder,
	onRefresh,
	onRenameNode,
	pendingCreate,
	project,
	renamingPath,
	selectedPath,
}: SidebarProps) {
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
						{project?.rootName ?? "No folder opened"}
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
						onClick={() => onBeginCreate("file", selectedPath ?? project?.rootPath)}
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
							onBeginCreate("directory", selectedPath ?? project?.rootPath)
						}
					>
						<FolderPlus className="h-4 w-4" />
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

			{error ? (
				<div className="border-b border-border-500 bg-destructive/10 px-4 py-2 text-xs text-foreground/80">
					{error}
				</div>
			) : null}

			<div className="min-h-0 flex-1 overflow-auto px-2 py-3">
				{project ? (
					<ProjectTree
						expandedPaths={expandedPaths}
						node={project.tree}
						onBeginCreate={onBeginCreate}
						onBeginRename={onBeginRename}
						onCancelInlineState={onCancelInlineState}
						onCreateNode={onCreateNode}
						onDeleteNode={onDeleteNode}
						onOpenNode={onOpenNode}
						onRenameNode={onRenameNode}
						pendingCreate={pendingCreate}
						renamingPath={renamingPath}
						selectedPath={selectedPath}
					/>
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
		</div>
	);
}
