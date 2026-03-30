import type {
	ProjectBridge,
	ProjectNode,
	ProjectPermissions,
	ProjectSnapshot,
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

let rootHandle: BrowserDirectoryHandle | null = null;
let rootPath = "";

function joinProjectPath(parentPath: string, name: string) {
	return parentPath === "/" ? `/${name}` : `${parentPath.replace(/\/$/, "")}/${name}`;
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
): Promise<ProjectNode> {
	const permissions = await getPermissions(handle);

	if (handle.kind === "file") {
		const file = await handle.getFile();
		return {
			path: currentPath,
			name: handle.name,
			kind: "file",
			permissions,
			modifiedAt: file.lastModified,
			size: file.size,
		};
	}

	const children: ProjectNode[] = [];
	if (permissions.read) {
		for await (const [name, entryHandle] of handle.entries()) {
			children.push(await buildNode(entryHandle, joinProjectPath(currentPath, name)));
		}
	}

	children.sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind === "directory" ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});

	return {
		path: currentPath,
		name: handle.name,
		kind: "directory",
		permissions,
		children,
	};
}

async function buildSnapshot(): Promise<ProjectSnapshot> {
	if (!rootHandle || !rootPath) {
		throw new Error("Open a project folder before refreshing the explorer.");
	}

	const permissions = await getPermissions(rootHandle);
	return {
		rootPath,
		rootName: rootHandle.name,
		source: "web",
		permissions,
		tree: await buildNode(rootHandle, rootPath),
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
			await ensurePermission(handle, "readwrite");
			rootHandle = handle;
			rootPath = `/${handle.name}`;
			return buildSnapshot();
		},

		async refreshProject() {
			if (rootHandle) {
				await ensurePermission(rootHandle, "read");
			}
			return buildSnapshot();
		},

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
			return buildSnapshot();
		},

		async createFolder(parentPath, name) {
			const parentHandle = await resolveDirectoryHandle(parentPath);
			await ensurePermission(parentHandle, "readwrite");
			await parentHandle.getDirectoryHandle(name, { create: true });
			return buildSnapshot();
		},

		async renamePath(targetPath, nextName) {
			const { name, parentHandle } = await resolveParent(targetPath);
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
			return buildSnapshot();
		},

		async deletePath(targetPath) {
			const { name, parentHandle } = await resolveParent(targetPath);
			const targetHandle = await resolveHandle(targetPath);
			await ensurePermission(parentHandle, "readwrite");
			await parentHandle.removeEntry(name, {
				recursive: targetHandle.kind === "directory",
			});
			return buildSnapshot();
		},
	};
}
