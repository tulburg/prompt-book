import { createBrowserProjectBridge } from "@/lib/browser-project-bridge";
import {
	disposeModelsForPath,
	getModelValue,
	renameModels,
	syncModel,
	updateModelContent,
} from "@/lib/monaco/model-store";
import type {
	ActiveFileState,
	ProjectBridge,
	ProjectNode,
	ProjectNodeKind,
	ProjectPermissions,
	ProjectSnapshot,
} from "@/lib/project-files";
import * as React from "react";

interface PendingCreateState {
	parentPath: string;
	kind: ProjectNodeKind;
}

const FALLBACK_PERMISSIONS: ProjectPermissions = {
	read: false,
	write: false,
	status: "unsupported",
	message: "Project file access is unavailable in this environment.",
};

function createActiveFileState(
	path: string,
	name: string,
	content: string,
	savedContent: string,
	permissions: ProjectPermissions,
	isLoading = false,
): ActiveFileState {
	return {
		path,
		name,
		content,
		savedContent,
		permissions,
		isLoading,
	};
}

function getProjectBridge(): ProjectBridge | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}

	return window.projectBridge ?? createBrowserProjectBridge();
}

function getAncestorPaths(targetPath: string, rootPath: string): string[] {
	if (!targetPath.startsWith(rootPath)) {
		return [rootPath];
	}

	const ancestors = [rootPath];
	const relativePath = targetPath.slice(rootPath.length).replace(/^[/\\]/, "");
	if (!relativePath) {
		return ancestors;
	}

	const segments = relativePath.split(/[/\\]/);
	let current = rootPath;
	for (let index = 0; index < segments.length - 1; index++) {
		current = current.endsWith("/")
			? `${current}${segments[index]}`
			: `${current}/${segments[index]}`;
		ancestors.push(current);
	}

	return ancestors;
}

function findNode(
	nodes: ProjectNode[],
	targetPath: string,
): ProjectNode | null {
	for (const node of nodes) {
		if (node.path === targetPath) {
			return node;
		}
		if (node.kind === "directory" && node.children) {
			const match = findNode(node.children, targetPath);
			if (match) {
				return match;
			}
		}
	}
	return null;
}

function findRootForPath(project: ProjectSnapshot, targetPath: string) {
	return project.roots.find(
		(root) =>
			targetPath === root.path || targetPath.startsWith(`${root.path}/`),
	);
}

function getDefaultExpandedPaths(snapshot: ProjectSnapshot): Set<string> {
	return new Set(snapshot.roots.map((root) => root.path));
}

function updateNodeInTree(
	nodes: ProjectNode[],
	targetPath: string,
	updater: (node: ProjectNode) => ProjectNode,
): ProjectNode[] {
	return nodes.map((node) => {
		if (node.path === targetPath) {
			return updater(node);
		}
		if (node.kind !== "directory" || !node.children) {
			return node;
		}
		return {
			...node,
			children: updateNodeInTree(node.children, targetPath, updater),
		};
	});
}

function removeNodeFromTree(
	nodes: ProjectNode[],
	targetPath: string,
): ProjectNode[] {
	return nodes
		.filter((node) => node.path !== targetPath)
		.map((node) => {
			if (node.kind !== "directory" || !node.children) {
				return node;
			}
			return {
				...node,
				children: removeNodeFromTree(node.children, targetPath),
			};
		});
}

function remapNodePaths(
	node: ProjectNode,
	oldPath: string,
	nextPath: string,
): ProjectNode {
	const mappedPath = node.path.replace(oldPath, nextPath);
	return {
		...node,
		path: mappedPath,
		parentPath: node.parentPath
			? node.parentPath.replace(oldPath, nextPath)
			: null,
		rootPath: node.rootPath.replace(oldPath, nextPath),
		children: node.children?.map((child) =>
			remapNodePaths(child, oldPath, nextPath),
		),
	};
}

function remapTreePaths(
	nodes: ProjectNode[],
	oldPath: string,
	nextPath: string,
): ProjectNode[] {
	return nodes.map((node) => {
		if (node.path === oldPath || node.path.startsWith(`${oldPath}/`)) {
			return remapNodePaths(node, oldPath, nextPath);
		}
		if (node.kind !== "directory" || !node.children) {
			return node;
		}
		return {
			...node,
			children: remapTreePaths(node.children, oldPath, nextPath),
		};
	});
}

function mergeWorkspaceRoots(
	currentRoots: ProjectNode[] | undefined,
	nextRoots: ProjectNode[],
): ProjectNode[] {
	if (!currentRoots) {
		return nextRoots;
	}

	return nextRoots.map((nextRoot) => {
		const currentRoot = currentRoots.find(
			(root) => root.path === nextRoot.path,
		);
		if (!currentRoot) {
			return nextRoot;
		}
		return {
			...nextRoot,
			children: currentRoot.children,
			isDirectoryResolved: currentRoot.isDirectoryResolved,
			isLoading: currentRoot.isLoading,
		};
	});
}

function remapPathSet(paths: Set<string>, oldPath: string, nextPath: string) {
	return new Set(
		[...paths].map((path) =>
			path === oldPath || path.startsWith(`${oldPath}/`)
				? path.replace(oldPath, nextPath)
				: path,
		),
	);
}

function remapPathList(paths: string[], oldPath: string, nextPath: string) {
	return paths.map((path) =>
		path === oldPath || path.startsWith(`${oldPath}/`)
			? path.replace(oldPath, nextPath)
			: path,
	);
}

function remapNullablePath(
	targetPath: string | null,
	oldPath: string,
	nextPath: string,
) {
	if (!targetPath || !isSameOrDescendantPath(targetPath, oldPath)) {
		return targetPath;
	}

	return targetPath.replace(oldPath, nextPath);
}

function remapFileStateMap(
	fileStates: Record<string, ActiveFileState>,
	oldPath: string,
	nextPath: string,
) {
	return Object.fromEntries(
		Object.entries(fileStates).map(([path, fileState]) => {
			if (path === oldPath || path.startsWith(`${oldPath}/`)) {
				const mappedPath = path.replace(oldPath, nextPath);
				return [
					mappedPath,
					{
						...fileState,
						path: mappedPath,
					},
				];
			}

			return [path, fileState];
		}),
	);
}

function removeFileStateEntries(
	fileStates: Record<string, ActiveFileState>,
	targetPath: string,
) {
	return Object.fromEntries(
		Object.entries(fileStates).filter(
			([path]) => !isSameOrDescendantPath(path, targetPath),
		),
	);
}

function isPathWithinWorkspace(
	project: ProjectSnapshot | null,
	targetPath: string | null,
) {
	if (!project || !targetPath) {
		return false;
	}

	return project.roots.some(
		(root) =>
			targetPath === root.path || targetPath.startsWith(`${root.path}/`),
	);
}

function isSameOrDescendantPath(targetPath: string, parentPath: string) {
	return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}

function collectDirectoriesToResolve(
	nodes: ProjectNode[],
	expandedPaths: Set<string>,
): string[] {
	const pathsToResolve: string[] = [];

	for (const node of nodes) {
		if (node.kind !== "directory") {
			continue;
		}

		if (
			expandedPaths.has(node.path) &&
			!node.isDirectoryResolved &&
			!node.isLoading
		) {
			pathsToResolve.push(node.path);
			continue;
		}

		if (node.children) {
			pathsToResolve.push(
				...collectDirectoriesToResolve(node.children, expandedPaths),
			);
		}
	}

	return pathsToResolve;
}

function useInitialProject(projectBridge: ProjectBridge | undefined) {
	const [project, setProject] = React.useState<ProjectSnapshot | null>(null);
	const [isBootstrapping, setIsBootstrapping] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;

		const restoreProject = async () => {
			if (!projectBridge) {
				setIsBootstrapping(false);
				return;
			}

			try {
				const restoredProject = await projectBridge.restoreLastProject();
				if (!cancelled && restoredProject) {
					setProject(restoredProject);
				}
			} catch (restoreError) {
				if (!cancelled) {
					setError(
						restoreError instanceof Error
							? restoreError.message
							: "Failed to restore the last project.",
					);
				}
			} finally {
				if (!cancelled) {
					setIsBootstrapping(false);
				}
			}
		};

		void restoreProject();

		return () => {
			cancelled = true;
		};
	}, [projectBridge]);

	return { error, isBootstrapping, project, setError, setProject };
}

export function useProjectManager() {
	const projectBridge = React.useMemo(() => getProjectBridge(), []);
	const { error, isBootstrapping, project, setError, setProject } =
		useInitialProject(projectBridge);
	const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
	const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(
		new Set(),
	);
	const [fileStates, setFileStates] = React.useState<
		Record<string, ActiveFileState>
	>({});
	const [openFilePaths, setOpenFilePaths] = React.useState<string[]>([]);
	const [previewFilePath, setPreviewFilePath] = React.useState<string | null>(
		null,
	);
	const [activeFilePath, setActiveFilePath] = React.useState<string | null>(
		null,
	);
	const [pendingCreate, setPendingCreate] =
		React.useState<PendingCreateState | null>(null);
	const [renamingPath, setRenamingPath] = React.useState<string | null>(null);
	const [isBusy, setIsBusy] = React.useState(false);
	const fileStatesRef = React.useRef(fileStates);
	const openFilePathsRef = React.useRef(openFilePaths);
	const previewFilePathRef = React.useRef(previewFilePath);
	const activeFilePathRef = React.useRef(activeFilePath);

	fileStatesRef.current = fileStates;
	openFilePathsRef.current = openFilePaths;
	previewFilePathRef.current = previewFilePath;
	activeFilePathRef.current = activeFilePath;

	const activeFile = React.useMemo(
		() => (activeFilePath ? (fileStates[activeFilePath] ?? null) : null),
		[activeFilePath, fileStates],
	);

	const openFiles = React.useMemo(() => {
		const visiblePaths = [...openFilePaths];
		if (previewFilePath && !visiblePaths.includes(previewFilePath)) {
			visiblePaths.push(previewFilePath);
		}

		return visiblePaths
			.map((path) => fileStates[path])
			.filter((file): file is ActiveFileState => Boolean(file));
	}, [fileStates, openFilePaths, previewFilePath]);

	React.useEffect(() => {
		if (!project) {
			setExpandedPaths(new Set());
			setSelectedPath(null);
			setFileStates({});
			setOpenFilePaths([]);
			setPreviewFilePath(null);
			setActiveFilePath(null);
			return;
		}

		setExpandedPaths((current) => {
			if (current.size > 0) {
				return new Set([...current, ...project.roots.map((root) => root.path)]);
			}
			return getDefaultExpandedPaths(project);
		});
		setSelectedPath((current) =>
			isPathWithinWorkspace(project, current)
				? current
				: (project.roots[0]?.path ?? null),
		);

		setFileStates((current) =>
			Object.fromEntries(
				Object.entries(current).filter(([path]) =>
					isPathWithinWorkspace(project, path),
				),
			),
		);
		setOpenFilePaths((current) =>
			current.filter((path) => isPathWithinWorkspace(project, path)),
		);
		setPreviewFilePath((current) =>
			isPathWithinWorkspace(project, current) ? current : null,
		);
		setActiveFilePath((current) =>
			isPathWithinWorkspace(project, current) ? current : null,
		);
	}, [project]);

	const selectedNode = React.useMemo(
		() =>
			project && selectedPath ? findNode(project.roots, selectedPath) : null,
		[project, selectedPath],
	);

	const ensureFileLoaded = React.useCallback(
		async (node: ProjectNode) => {
			if (!projectBridge) {
				setError(
					FALLBACK_PERMISSIONS.message ?? "Project access is unavailable.",
				);
				return false;
			}

			const existingFile = fileStatesRef.current[node.path];
			setFileStates((current) => ({
				...current,
				[node.path]: existingFile
					? {
							...existingFile,
							name: node.name,
							permissions: node.permissions,
						}
					: createActiveFileState(
							node.path,
							node.name,
							"",
							"",
							node.permissions,
							true,
						),
			}));

			if (existingFile && !existingFile.isLoading) {
				return true;
			}

			try {
				const fileResult = await projectBridge.readFile(node.path);
				const nextContent = getModelValue(node.path) ?? fileResult.content;
				syncModel(node.path, nextContent);
				setFileStates((current) => ({
					...current,
					[node.path]: createActiveFileState(
						node.path,
						node.name,
						nextContent,
						fileResult.content,
						fileResult.permissions,
					),
				}));
				return true;
			} catch (readError) {
				setFileStates((current) => {
					const next = { ...current };
					delete next[node.path];
					return next;
				});
				setOpenFilePaths((current) =>
					current.filter((path) => path !== node.path),
				);
				setPreviewFilePath((current) =>
					current === node.path ? null : current,
				);
				setActiveFilePath((current) =>
					current === node.path ? null : current,
				);
				setError(
					readError instanceof Error
						? readError.message
						: "Failed to open the selected file.",
				);
				return false;
			}
		},
		[projectBridge, setError],
	);

	const previewNode = React.useCallback(
		async (node: ProjectNode) => {
			setSelectedPath(node.path);
			setError(null);

			if (node.kind === "directory") {
				setExpandedPaths((current) => {
					const nextExpanded = new Set(current);
					if (nextExpanded.has(node.path)) {
						nextExpanded.delete(node.path);
					} else {
						nextExpanded.add(node.path);
					}
					return nextExpanded;
				});
				return;
			}

			setActiveFilePath(node.path);
			if (!openFilePathsRef.current.includes(node.path)) {
				setPreviewFilePath(node.path);
			}

			await ensureFileLoaded(node);
		},
		[ensureFileLoaded, setError],
	);

	const loadDirectory = React.useCallback(
		async (directoryPath: string) => {
			if (!projectBridge) {
				setError(
					FALLBACK_PERMISSIONS.message ?? "Project access is unavailable.",
				);
				return;
			}

			setProject((current) =>
				current
					? {
							...current,
							roots: updateNodeInTree(current.roots, directoryPath, (node) => ({
								...node,
								isLoading: true,
							})),
						}
					: current,
			);

			try {
				const listing = await projectBridge.listDirectory(directoryPath);
				setProject((current) =>
					current
						? {
								...current,
								roots: updateNodeInTree(
									current.roots,
									directoryPath,
									(node) => ({
										...node,
										children: listing.children,
										isDirectoryResolved: true,
										isLoading: false,
										modifiedAt: listing.modifiedAt ?? node.modifiedAt,
										permissions: listing.permissions,
									}),
								),
							}
						: current,
				);
			} catch (loadError) {
				setProject((current) =>
					current
						? {
								...current,
								roots: updateNodeInTree(
									current.roots,
									directoryPath,
									(node) => ({
										...node,
										isLoading: false,
									}),
								),
							}
						: current,
				);
				setError(
					loadError instanceof Error
						? loadError.message
						: "Failed to load the selected folder.",
				);
			}
		},
		[projectBridge, setProject, setError],
	);

	React.useEffect(() => {
		if (!project || !projectBridge) {
			return;
		}

		const pathsToResolve = collectDirectoriesToResolve(
			project.roots,
			expandedPaths,
		);
		for (const directoryPath of pathsToResolve) {
			void loadDirectory(directoryPath);
		}
	}, [expandedPaths, loadDirectory, project, projectBridge]);

	const applyProjectSnapshot = React.useCallback(
		(nextProject: ProjectSnapshot, preferredPath?: string | null) => {
			setProject((current) => ({
				...nextProject,
				roots: mergeWorkspaceRoots(current?.roots, nextProject.roots),
			}));
			setExpandedPaths((current) => {
				const nextExpanded =
					current.size > 0
						? new Set(current)
						: getDefaultExpandedPaths(nextProject);
				for (const root of nextProject.roots) {
					nextExpanded.add(root.path);
					for (const ancestor of getAncestorPaths(
						preferredPath ?? root.path,
						root.path,
					)) {
						nextExpanded.add(ancestor);
					}
				}
				return nextExpanded;
			});
			setSelectedPath(preferredPath ?? nextProject.roots[0]?.path ?? null);
		},
		[setProject],
	);

	const openProjectFolder = React.useCallback(async () => {
		if (!projectBridge) {
			setError(
				FALLBACK_PERMISSIONS.message ?? "Project access is unavailable.",
			);
			return;
		}

		setIsBusy(true);
		setError(null);
		try {
			const openedProject = await projectBridge.openProjectFolder();
			if (openedProject) {
				applyProjectSnapshot(
					openedProject,
					selectedPath ?? openedProject.roots[0]?.path ?? null,
				);
			}
		} catch (openError) {
			setError(
				openError instanceof Error
					? openError.message
					: "Failed to open the selected folder.",
			);
		} finally {
			setIsBusy(false);
		}
	}, [applyProjectSnapshot, projectBridge, selectedPath, setError]);

	const refreshProject = React.useCallback(
		async (preferredPath?: string | null) => {
			if (!projectBridge || !project) {
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const refreshedProject = await projectBridge.refreshProject();
				applyProjectSnapshot(
					refreshedProject,
					preferredPath ??
						selectedPath ??
						refreshedProject.roots[0]?.path ??
						null,
				);
			} catch (refreshError) {
				setError(
					refreshError instanceof Error
						? refreshError.message
						: "Failed to refresh the project tree.",
				);
			} finally {
				setIsBusy(false);
			}
		},
		[applyProjectSnapshot, project, projectBridge, selectedPath, setError],
	);

	const openNode = React.useCallback(
		async (node: ProjectNode) => {
			setSelectedPath(node.path);
			setError(null);

			if (node.kind === "directory") {
				setExpandedPaths((current) => {
					const nextExpanded = new Set(current);
					if (nextExpanded.has(node.path)) {
						nextExpanded.delete(node.path);
					} else {
						nextExpanded.add(node.path);
					}
					return nextExpanded;
				});
				return;
			}

			if (!projectBridge) {
				setError(
					FALLBACK_PERMISSIONS.message ?? "Project access is unavailable.",
				);
				return;
			}

			setActiveFilePath(node.path);
			setOpenFilePaths((current) =>
				current.includes(node.path) ? current : [...current, node.path],
			);
			setPreviewFilePath((current) => (current === node.path ? null : current));
			await ensureFileLoaded(node);
		},
		[ensureFileLoaded, projectBridge, setError],
	);

	const activateFile = React.useCallback(
		(path: string) => {
			setActiveFilePath(path);
			setSelectedPath(path);
			setError(null);
		},
		[setError],
	);

	const pinFile = React.useCallback(
		(path: string) => {
			setOpenFilePaths((current) =>
				current.includes(path) ? current : [...current, path],
			);
			setPreviewFilePath((current) => (current === path ? null : current));
			setActiveFilePath(path);
			setSelectedPath(path);
			setError(null);
		},
		[setError],
	);

	const closeFile = React.useCallback((path: string) => {
		const visiblePaths = [...openFilePathsRef.current];
		if (
			previewFilePathRef.current &&
			!visiblePaths.includes(previewFilePathRef.current)
		) {
			visiblePaths.push(previewFilePathRef.current);
		}

		const closingIndex = visiblePaths.indexOf(path);
		const nextVisiblePaths = visiblePaths.filter(
			(filePath) => filePath !== path,
		);
		const nextActivePath =
			activeFilePathRef.current === path
				? (nextVisiblePaths[closingIndex] ??
					nextVisiblePaths[closingIndex - 1] ??
					nextVisiblePaths[0] ??
					null)
				: activeFilePathRef.current;

		setOpenFilePaths((current) =>
			current.filter((filePath) => filePath !== path),
		);
		setPreviewFilePath((current) => (current === path ? null : current));
		setActiveFilePath(nextActivePath);
		if (activeFilePathRef.current === path && nextActivePath) {
			setSelectedPath(nextActivePath);
		}
	}, []);

	const selectNode = React.useCallback(
		(node: ProjectNode) => {
			setSelectedPath(node.path);
			setError(null);
		},
		[setError],
	);

	const updateActiveFileContent = React.useCallback((content: string) => {
		setFileStates((current) => {
			const path = activeFilePathRef.current;
			if (!path || !current[path]) {
				return current;
			}

			updateModelContent(path, content);
			return {
				...current,
				[path]: {
					...current[path],
					content,
				},
			};
		});
	}, []);

	const saveActiveFile = React.useCallback(async () => {
		if (!projectBridge || !activeFile) {
			return;
		}

		setIsBusy(true);
		setError(null);
		try {
			const nextContent = getModelValue(activeFile.path) ?? activeFile.content;
			const result = await projectBridge.writeFile(
				activeFile.path,
				nextContent,
			);
			setFileStates((current) => {
				if (!current[activeFile.path]) {
					return current;
				}

				return {
					...current,
					[activeFile.path]: {
						...current[activeFile.path],
						content: nextContent,
						savedContent: nextContent,
						permissions: result.permissions,
					},
				};
			});
		} catch (writeError) {
			setError(
				writeError instanceof Error
					? writeError.message
					: "Failed to save the active file.",
			);
		} finally {
			setIsBusy(false);
		}
	}, [activeFile, projectBridge, setError]);

	const beginCreate = React.useCallback(
		(kind: ProjectNodeKind, targetPath?: string) => {
			if (!project) {
				return;
			}

			const targetNode = targetPath
				? findNode(project.roots, targetPath)
				: null;
			const targetRoot = targetPath
				? findRootForPath(project, targetPath)
				: (project.roots[0] ?? null);
			const parentPath =
				targetNode?.kind === "directory"
					? targetNode.path
					: targetNode?.path
						? (targetNode.parentPath ??
							targetRoot?.path ??
							project.roots[0]?.path ??
							null)
						: (targetRoot?.path ?? project.roots[0]?.path ?? null);

			if (!parentPath) {
				return;
			}

			setExpandedPaths((current) => new Set(current).add(parentPath));
			setPendingCreate({ kind, parentPath });
			setRenamingPath(null);
		},
		[project],
	);

	const createNode = React.useCallback(
		async (name: string) => {
			if (!projectBridge || !pendingCreate) {
				return;
			}

			const trimmedName = name.trim();
			if (!trimmedName) {
				setPendingCreate(null);
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const result =
					pendingCreate.kind === "file"
						? await projectBridge.createFile(
								pendingCreate.parentPath,
								trimmedName,
								"",
							)
						: await projectBridge.createFolder(
								pendingCreate.parentPath,
								trimmedName,
							);

				await loadDirectory(result.parentPath);
				setSelectedPath(result.node.path);
				setPendingCreate(null);
			} catch (createError) {
				setError(
					createError instanceof Error
						? createError.message
						: `Failed to create the ${pendingCreate.kind}.`,
				);
			} finally {
				setIsBusy(false);
			}
		},
		[loadDirectory, pendingCreate, projectBridge, setError],
	);

	const copyNode = React.useCallback(
		async (sourcePath: string, targetDirectoryPath: string) => {
			if (!projectBridge?.copyPath) {
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const result = await projectBridge.copyPath(
					sourcePath,
					targetDirectoryPath,
				);
				await loadDirectory(result.parentPath);
				setExpandedPaths((current) => new Set(current).add(result.parentPath));
				setSelectedPath(result.node.path);
			} catch (copyError) {
				setError(
					copyError instanceof Error
						? copyError.message
						: "Failed to copy the selected item.",
				);
			} finally {
				setIsBusy(false);
			}
		},
		[loadDirectory, projectBridge, setError],
	);

	const beginRename = React.useCallback((targetPath: string) => {
		setPendingCreate(null);
		setRenamingPath(targetPath);
	}, []);

	const renameNode = React.useCallback(
		async (nextName: string) => {
			if (!projectBridge || !project || !renamingPath) {
				return;
			}

			const trimmedName = nextName.trim();
			if (!trimmedName) {
				setRenamingPath(null);
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const result = await projectBridge.renamePath(
					renamingPath,
					trimmedName,
				);
				const nextPath = result.node.path;

				renameModels(renamingPath, nextPath);
				setProject((current) =>
					current
						? {
								...current,
								roots: remapTreePaths(current.roots, renamingPath, nextPath),
							}
						: current,
				);
				setExpandedPaths((current) =>
					remapPathSet(current, renamingPath, nextPath),
				);
				setSelectedPath((current) =>
					current === renamingPath || current?.startsWith(`${renamingPath}/`)
						? current.replace(renamingPath, nextPath)
						: current,
				);
				setFileStates((current) => {
					const nextStates = remapFileStateMap(current, renamingPath, nextPath);
					const renamedFile = nextStates[nextPath];
					if (renamedFile && renamingPath === result.oldPath) {
						nextStates[nextPath] = { ...renamedFile, name: trimmedName };
					}
					return nextStates;
				});
				setOpenFilePaths((current) =>
					remapPathList(current, renamingPath, nextPath),
				);
				setPreviewFilePath((current) =>
					remapNullablePath(current, renamingPath, nextPath),
				);
				setActiveFilePath((current) =>
					remapNullablePath(current, renamingPath, nextPath),
				);

				if (result.parentPath) {
					await loadDirectory(result.parentPath);
				}
				setRenamingPath(null);
			} catch (renameError) {
				setError(
					renameError instanceof Error
						? renameError.message
						: "Failed to rename the selected item.",
				);
			} finally {
				setIsBusy(false);
			}
		},
		[loadDirectory, project, projectBridge, renamingPath, setError, setProject],
	);

	const moveNode = React.useCallback(
		async (sourcePath: string, targetDirectoryPath: string) => {
			if (!projectBridge?.movePath || !project) {
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const result = await projectBridge.movePath(
					sourcePath,
					targetDirectoryPath,
				);
				const nextPath = result.node.path;

				renameModels(sourcePath, nextPath);
				setProject((current) =>
					current
						? {
								...current,
								roots: remapTreePaths(
									removeNodeFromTree(current.roots, sourcePath),
									sourcePath,
									nextPath,
								),
							}
						: current,
				);
				setExpandedPaths((current) => {
					const next = remapPathSet(current, sourcePath, nextPath);
					next.add(targetDirectoryPath);
					return next;
				});
				setSelectedPath(nextPath);
				setFileStates((current) =>
					remapFileStateMap(current, sourcePath, nextPath),
				);
				setOpenFilePaths((current) =>
					remapPathList(current, sourcePath, nextPath),
				);
				setPreviewFilePath((current) =>
					remapNullablePath(current, sourcePath, nextPath),
				);
				setActiveFilePath((current) =>
					remapNullablePath(current, sourcePath, nextPath),
				);

				const sourceParent = sourcePath.substring(
					0,
					sourcePath.lastIndexOf("/"),
				);
				if (sourceParent) {
					await loadDirectory(sourceParent);
				}
				await loadDirectory(targetDirectoryPath);
			} catch (moveError) {
				setError(
					moveError instanceof Error
						? moveError.message
						: "Failed to move the selected item.",
				);
			} finally {
				setIsBusy(false);
			}
		},
		[loadDirectory, project, projectBridge, setError, setProject],
	);

	const revealPath = React.useCallback(
		(targetPath: string) => {
			if (!project) return;

			const root = project.roots.find(
				(r) => targetPath === r.path || targetPath.startsWith(`${r.path}/`),
			);
			if (!root) return;

			setExpandedPaths((current) => {
				const nextExpanded = new Set(current);
				for (const ancestor of getAncestorPaths(targetPath, root.path)) {
					nextExpanded.add(ancestor);
				}
				return nextExpanded;
			});
			setSelectedPath(targetPath);
		},
		[project],
	);

	const deleteNode = React.useCallback(
		async (targetPath: string) => {
			if (!projectBridge || !project) {
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const result = await projectBridge.deletePath(targetPath);
				const nextSelection =
					result.parentPath ?? project.roots[0]?.path ?? null;

				disposeModelsForPath(targetPath);
				setProject((current) =>
					current
						? {
								...current,
								roots: removeNodeFromTree(current.roots, targetPath),
							}
						: current,
				);
				setExpandedPaths((current) => {
					const nextExpanded = new Set(current);
					for (const path of [...nextExpanded]) {
						if (path === targetPath || path.startsWith(`${targetPath}/`)) {
							nextExpanded.delete(path);
						}
					}
					return nextExpanded;
				});
				setFileStates((current) => removeFileStateEntries(current, targetPath));
				setOpenFilePaths((current) =>
					current.filter((path) => !isSameOrDescendantPath(path, targetPath)),
				);
				setPreviewFilePath((current) =>
					current && isSameOrDescendantPath(current, targetPath)
						? null
						: current,
				);
				setActiveFilePath((current) =>
					current && isSameOrDescendantPath(current, targetPath)
						? null
						: current,
				);

				setSelectedPath(nextSelection);
				if (result.parentPath) {
					await loadDirectory(result.parentPath);
				}
				setPendingCreate(null);
				setRenamingPath(null);
			} catch (deleteError) {
				setError(
					deleteError instanceof Error
						? deleteError.message
						: "Failed to delete the selected item.",
				);
			} finally {
				setIsBusy(false);
			}
		},
		[loadDirectory, project, projectBridge, setError, setProject],
	);

	return {
		activeFile,
		activeFilePath,
		activateFile,
		beginCreate,
		beginRename,
		closeFile,
		copyNode,
		createNode,
		deleteNode,
		error,
		expandedPaths,
		isBootstrapping,
		isBusy,
		moveNode,
		openFiles,
		openNode,
		pinFile,
		previewFilePath,
		previewNode,
		projectBridge,
		revealPath,
		selectNode,
		openProjectFolder,
		pendingCreate,
		project,
		refreshProject,
		renameNode,
		renamingPath,
		saveActiveFile,
		selectedNode,
		selectedPath,
		setPendingCreate,
		setRenamingPath,
		updateActiveFileContent,
	};
}
