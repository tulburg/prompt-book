import type {
	CreateNodeResult,
	DeleteNodeResult,
	DirectoryListingResult,
	ProjectBridge,
	ProjectNode,
	ProjectPermissions,
	ProjectSnapshot,
	RenameNodeResult,
} from "@/lib/project-files";

type BrowserPermissionState = "granted" | "prompt" | "denied";
type BrowserPermissionMode = "read" | "readwrite";

interface BrowserFileWriter {
	write(data: string | BufferSource): Promise<void>;
	close(): Promise<void>;
}

interface BrowserHandle extends FileSystemHandle {
	queryPermission(descriptor: {
		mode: BrowserPermissionMode;
	}): Promise<BrowserPermissionState>;
	requestPermission(descriptor: {
		mode: BrowserPermissionMode;
	}): Promise<BrowserPermissionState>;
}

interface BrowserFileHandle extends BrowserHandle {
	kind: "file";
	getFile(): Promise<File>;
	createWritable(): Promise<BrowserFileWriter>;
}

interface BrowserDirectoryHandle extends BrowserHandle {
	kind: "directory";
	entries(): AsyncIterableIterator<[string, BrowserDirectoryHandle | BrowserFileHandle]>;
	getDirectoryHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<BrowserDirectoryHandle>;
	getFileHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<BrowserFileHandle>;
	removeEntry(
		name: string,
		options?: { recursive?: boolean },
	): Promise<void>;
}

interface BrowserWindowWithFs extends Window {
	showDirectoryPicker(): Promise<BrowserDirectoryHandle>;
}

const rootHandles = new Map<string, BrowserDirectoryHandle>();

function joinProjectPath(parentPath: string, name: string) {
	return parentPath === "/" ? `/${name}` : `${parentPath.replace(/\/$/, "")}/${name}`;
}

function normalizeProjectPath(targetPath: string) {
	return targetPath.replace(/\/+$/, "") || "/";
}

function dedupeProjectPaths(paths: string[]) {
	return [...new Set(paths.map((path) => normalizeProjectPath(path)))];
}

function getWorkspaceRootPaths() {
	return dedupeProjectPaths([...rootHandles.keys()]);
}

function getRootPathForTarget(targetPath: string) {
	const normalizedTargetPath = normalizeProjectPath(targetPath);
	return getWorkspaceRootPaths()
		.sort((left, right) => right.length - left.length)
		.find(
			(rootPath) =>
				normalizedTargetPath === rootPath ||
				normalizedTargetPath.startsWith(`${rootPath}/`),
		);
}

function createUniqueRootPath(handle: BrowserDirectoryHandle) {
	const basePath = normalizeProjectPath(`/${handle.name}`);
	if (!rootHandles.has(basePath)) {
		return basePath;
	}

	let suffix = 2;
	while (rootHandles.has(`${basePath}-${suffix}`)) {
		suffix += 1;
	}
	return `${basePath}-${suffix}`;
}

function isBrowserDirectoryHandle(
	handle: BrowserHandle,
): handle is BrowserDirectoryHandle {
	return handle.kind === "directory";
}

function isBrowserFileHandle(handle: BrowserHandle): handle is BrowserFileHandle {
	return handle.kind === "file";
}

function getRelativeSegments(targetPath: string) {
	const rootPath = getRootPathForTarget(targetPath);
	if (!rootPath || targetPath === rootPath) {
		return [];
	}

	return targetPath
		.slice(rootPath.length)
		.replace(/^\/+/, "")
		.split("/")
		.filter(Boolean);
}

async function getPermissions(handle: BrowserHandle): Promise<ProjectPermissions> {
	const readState = await handle.queryPermission({ mode: "read" });
	let writeState: PermissionState | undefined;

	try {
		writeState = await handle.queryPermission({ mode: "readwrite" });
	} catch {
		writeState = undefined;
	}

	if (readState === "granted" && writeState === "granted") {
		return { read: true, write: true, status: "granted" };
	}

	if (readState === "granted" || writeState === "granted") {
		return {
			read: readState === "granted",
			write: writeState === "granted",
			status: "partial",
			message: "This item is only partially accessible.",
		};
	}

	if (readState === "prompt" || writeState === "prompt") {
		return {
			read: false,
			write: false,
			status: "prompt",
			message: "Permission is required before this item can be accessed.",
		};
	}

	return {
		read: false,
		write: false,
		status: "denied",
		message: "This item cannot be accessed with the current permissions.",
	};
}

async function ensurePermission(
	handle: BrowserHandle,
	mode: "read" | "readwrite",
) {
	let state = await handle.queryPermission({ mode });
	if (state !== "granted") {
		state = await handle.requestPermission({ mode });
	}

	if (state !== "granted") {
		throw new Error("Permission was not granted for this operation.");
	}
}

async function resolveHandle(targetPath: string): Promise<BrowserHandle> {
	const rootPath = getRootPathForTarget(targetPath);
	const rootHandle = rootPath ? rootHandles.get(rootPath) ?? null : null;
	if (!rootHandle || !rootPath) {
		throw new Error("Open a project folder before working with files.");
	}

	if (targetPath === rootPath) {
		return rootHandle;
	}

	const segments = getRelativeSegments(targetPath);
	let current: BrowserDirectoryHandle = rootHandle;

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		const isLastSegment = index === segments.length - 1;

		if (isLastSegment) {
			try {
				return await current.getDirectoryHandle(segment);
			} catch {
				return current.getFileHandle(segment);
			}
		}

		current = await current.getDirectoryHandle(segment);
	}

	return current;
}

async function resolveDirectoryHandle(
	targetPath: string,
): Promise<BrowserDirectoryHandle> {
	const handle = await resolveHandle(targetPath);
	if (!isBrowserDirectoryHandle(handle)) {
		throw new Error("The selected path is not a folder.");
	}

	return handle;
}

async function resolveParent(targetPath: string) {
	const rootPath = getRootPathForTarget(targetPath);
	if (!rootPath) {
		throw new Error(`No workspace root found for: ${targetPath}`);
	}
	if (targetPath === rootPath) {
		throw new Error("The project root cannot be modified this way.");
	}

	const segments = getRelativeSegments(targetPath);
	const name = segments.at(-1);
	if (!name) {
		throw new Error("Invalid path.");
	}

	const parentSegments = segments.slice(0, -1);
	let parentPath = rootPath;
	for (const segment of parentSegments) {
		parentPath = joinProjectPath(parentPath, segment);
	}

	return {
		name,
		parentHandle: await resolveDirectoryHandle(parentPath),
		parentPath,
	};
}

async function copyFileHandle(
	source: BrowserFileHandle,
	targetParent: BrowserDirectoryHandle,
	targetName: string,
) {
	const target = await targetParent.getFileHandle(targetName, { create: true });
	const sourceFile = await source.getFile();
	const writable = await target.createWritable();
	await writable.write(await sourceFile.arrayBuffer());
	await writable.close();
}

async function copyDirectoryHandle(
	source: BrowserDirectoryHandle,
	targetParent: BrowserDirectoryHandle,
	targetName: string,
) {
	const target = await targetParent.getDirectoryHandle(targetName, { create: true });

	for await (const [entryName, entryHandle] of source.entries()) {
		if (entryHandle.kind === "directory") {
			await copyDirectoryHandle(entryHandle, target, entryName);
			continue;
		}

		await copyFileHandle(entryHandle, target, entryName);
	}
}

async function buildNode(
	handle: BrowserDirectoryHandle | BrowserFileHandle,
	currentPath: string,
	parentPath: string | null,
	rootPath: string,
): Promise<ProjectNode> {
	const permissions = await getPermissions(handle);

	if (handle.kind === "file") {
		const file = await handle.getFile();
		return {
			path: currentPath,
			name: handle.name,
			kind: "file",
			parentPath,
			rootPath,
			permissions,
			modifiedAt: file.lastModified,
			size: file.size,
		};
	}

	return {
		path: currentPath,
		name: handle.name,
		kind: "directory",
		parentPath,
		rootPath,
		permissions,
		isDirectoryResolved: false,
	};
}

async function buildSnapshot(): Promise<ProjectSnapshot> {
	const rootPaths = getWorkspaceRootPaths();
	if (rootPaths.length === 0) {
		throw new Error("Open a project folder before refreshing the explorer.");
	}

	return {
		source: "web",
		roots: await Promise.all(
			rootPaths.map(async (rootPath) => {
				const handle = rootHandles.get(rootPath);
				if (!handle) {
					throw new Error(`Missing workspace root: ${rootPath}`);
				}
				return buildNode(handle, rootPath, null, rootPath);
			}),
		),
	};
}

function sortNodes(left: ProjectNode, right: ProjectNode) {
	if (left.kind !== right.kind) {
		return left.kind === "directory" ? -1 : 1;
	}
	return left.name.localeCompare(right.name);
}

async function listDirectory(directoryPath: string): Promise<DirectoryListingResult> {
	const directoryHandle = await resolveDirectoryHandle(directoryPath);
	await ensurePermission(directoryHandle, "read");
	const rootPath = getRootPathForTarget(directoryPath);
	if (!rootPath) {
		throw new Error(`No workspace root found for: ${directoryPath}`);
	}

	const children: ProjectNode[] = [];
	for await (const [name, entryHandle] of directoryHandle.entries()) {
		children.push(
			await buildNode(entryHandle, joinProjectPath(directoryPath, name), directoryPath, rootPath),
		);
	}

	children.sort(sortNodes);
	return {
		path: directoryPath,
		children,
		permissions: await getPermissions(directoryHandle),
	};
}

async function createNodeResult(
	parentPath: string,
	nodePath: string,
): Promise<CreateNodeResult> {
	const handle = await resolveHandle(nodePath);
	const rootPath = getRootPathForTarget(nodePath);
	if (!rootPath) {
		throw new Error(`No workspace root found for: ${nodePath}`);
	}

	return {
		parentPath,
		node: await buildNode(handle as BrowserDirectoryHandle | BrowserFileHandle, nodePath, parentPath, rootPath),
	};
}

async function createRenameResult(
	oldPath: string,
	nextPath: string,
	parentPath: string,
): Promise<RenameNodeResult> {
	const handle = await resolveHandle(nextPath);
	const rootPath = getRootPathForTarget(nextPath);
	if (!rootPath) {
		throw new Error(`No workspace root found for: ${nextPath}`);
	}

	return {
		oldPath,
		parentPath,
		node: await buildNode(handle as BrowserDirectoryHandle | BrowserFileHandle, nextPath, parentPath, rootPath),
	};
}

export function createBrowserProjectBridge(): ProjectBridge | undefined {
	const browserWindow = window as unknown as BrowserWindowWithFs;

	if (
		typeof window === "undefined" ||
		typeof browserWindow.showDirectoryPicker !== "function"
	) {
		return undefined;
	}

	return {
		async restoreLastProject() {
			return null;
		},

		async openProjectFolder() {
			const handle = await browserWindow.showDirectoryPicker();
			await ensurePermission(handle, "read");
			const rootPath = createUniqueRootPath(handle);
			rootHandles.set(rootPath, handle);
			return buildSnapshot();
		},

		async refreshProject() {
			for (const rootHandle of rootHandles.values()) {
				await ensurePermission(rootHandle, "read");
			}
			return buildSnapshot();
		},

		listDirectory,

		async readFile(filePath) {
			const handle = await resolveHandle(filePath);
			if (!isBrowserFileHandle(handle)) {
				throw new Error("Only files can be opened in the editor.");
			}

			await ensurePermission(handle, "read");
			const file = await handle.getFile();
			return {
				content: await file.text(),
				permissions: await getPermissions(handle),
			};
		},

		async writeFile(filePath, content) {
			const handle = await resolveHandle(filePath);
			if (!isBrowserFileHandle(handle)) {
				throw new Error("Only files can be saved.");
			}

			await ensurePermission(handle, "readwrite");
			const writable = await handle.createWritable();
			await writable.write(content);
			await writable.close();
			return {
				permissions: await getPermissions(handle),
			};
		},

		async createFile(parentPath, name, content = "") {
			const parentHandle = await resolveDirectoryHandle(parentPath);
			await ensurePermission(parentHandle, "readwrite");
			const fileHandle = await parentHandle.getFileHandle(name, { create: true });
			if (content) {
				const writable = await fileHandle.createWritable();
				await writable.write(content);
				await writable.close();
			}
			return createNodeResult(parentPath, joinProjectPath(parentPath, name));
		},

		async createFolder(parentPath, name) {
			const parentHandle = await resolveDirectoryHandle(parentPath);
			await ensurePermission(parentHandle, "readwrite");
			await parentHandle.getDirectoryHandle(name, { create: true });
			return createNodeResult(parentPath, joinProjectPath(parentPath, name));
		},

		async renamePath(targetPath, nextName) {
			const { name, parentHandle, parentPath } = await resolveParent(targetPath);
			const sourceHandle = await resolveHandle(targetPath);
			await ensurePermission(parentHandle, "readwrite");

			if (isBrowserDirectoryHandle(sourceHandle)) {
				await copyDirectoryHandle(sourceHandle, parentHandle, nextName);
			} else if (isBrowserFileHandle(sourceHandle)) {
				await copyFileHandle(sourceHandle, parentHandle, nextName);
			} else {
				throw new Error("Unsupported file system handle.");
			}

			await parentHandle.removeEntry(name, { recursive: sourceHandle.kind === "directory" });
			return createRenameResult(
				targetPath,
				joinProjectPath(parentPath, nextName),
				parentPath,
			);
		},

		async deletePath(targetPath) {
			const { name, parentHandle, parentPath } = await resolveParent(targetPath);
			const targetHandle = await resolveHandle(targetPath);
			await ensurePermission(parentHandle, "readwrite");
			await parentHandle.removeEntry(name, {
				recursive: targetHandle.kind === "directory",
			});
			return {
				deletedPath: targetPath,
				parentPath: parentPath ?? null,
			} satisfies DeleteNodeResult;
		},
	};
}
