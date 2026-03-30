export type ProjectNodeKind = "file" | "directory";

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
	permissions: ProjectPermissions;
	size?: number;
	modifiedAt?: number;
	children?: ProjectNode[];
}

export interface ProjectSnapshot {
	rootPath: string;
	rootName: string;
	source: "electron" | "web";
	permissions: ProjectPermissions;
	tree: ProjectNode;
}

export interface ActiveFileState {
	path: string;
	name: string;
	content: string;
	savedContent: string;
	permissions: ProjectPermissions;
	isLoading: boolean;
}

export interface ProjectBridge {
	restoreLastProject: () => Promise<ProjectSnapshot | null>;
	openProjectFolder: () => Promise<ProjectSnapshot | null>;
	refreshProject: (rootPath: string) => Promise<ProjectSnapshot>;
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
	) => Promise<ProjectSnapshot>;
	createFolder: (parentPath: string, name: string) => Promise<ProjectSnapshot>;
	renamePath: (targetPath: string, nextName: string) => Promise<ProjectSnapshot>;
	deletePath: (targetPath: string) => Promise<ProjectSnapshot>;
}
