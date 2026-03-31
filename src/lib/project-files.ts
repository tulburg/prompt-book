export type ProjectNodeKind = "file" | "directory";
export type ProjectSource = "electron" | "web";

export type GitFileStatus =
	| "modified"
	| "added"
	| "deleted"
	| "renamed"
	| "untracked"
	| "ignored"
	| "conflict";

export type GitStatusMap = Record<string, GitFileStatus>;

export interface ProjectPermissions {
	read: boolean;
	write: boolean;
	status: "granted" | "partial" | "denied" | "prompt" | "unsupported";
	message?: string;
}

export interface ProjectNode {
	path: string;
	name: string;
	kind: ProjectNodeKind;
	parentPath: string | null;
	rootPath: string;
	permissions: ProjectPermissions;
	size?: number;
	modifiedAt?: number;
	childCount?: number;
	children?: ProjectNode[];
	isDirectoryResolved?: boolean;
	isLoading?: boolean;
}

export interface ProjectSnapshot {
	source: ProjectSource;
	roots: ProjectNode[];
}

export interface ActiveFileState {
	path: string;
	name: string;
	content: string;
	savedContent: string;
	permissions: ProjectPermissions;
	isLoading: boolean;
}

export interface DirectoryListingResult {
	path: string;
	children: ProjectNode[];
	permissions: ProjectPermissions;
	modifiedAt?: number;
}

export interface CreateNodeResult {
	node: ProjectNode;
	parentPath: string;
}

export interface RenameNodeResult {
	node: ProjectNode;
	oldPath: string;
	parentPath: string | null;
}

export interface DeleteNodeResult {
	deletedPath: string;
	parentPath: string | null;
}

export interface ProjectBridge {
	restoreLastProject: () => Promise<ProjectSnapshot | null>;
	openProjectFolder: () => Promise<ProjectSnapshot | null>;
	refreshProject: () => Promise<ProjectSnapshot>;
	listDirectory: (directoryPath: string) => Promise<DirectoryListingResult>;
	readFile: (filePath: string) => Promise<{
		content: string;
		permissions: ProjectPermissions;
	}>;
	writeFile: (filePath: string, content: string) => Promise<{
		permissions: ProjectPermissions;
	}>;
	createFile: (
		parentPath: string,
		name: string,
		content?: string,
	) => Promise<CreateNodeResult>;
	createFolder: (parentPath: string, name: string) => Promise<CreateNodeResult>;
	renamePath: (targetPath: string, nextName: string) => Promise<RenameNodeResult>;
	deletePath: (targetPath: string) => Promise<DeleteNodeResult>;
	gitStatus?: (rootPath: string) => Promise<GitStatusMap | null>;
}
