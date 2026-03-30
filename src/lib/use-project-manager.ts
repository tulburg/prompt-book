import * as React from "react";
import { createBrowserProjectBridge } from "@/lib/browser-project-bridge";
import type {
	ActiveFileState,
	ProjectBridge,
	ProjectNode,
	ProjectNodeKind,
	ProjectPermissions,
	ProjectSnapshot,
} from "@/lib/project-files";

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

function getProjectBridge(): ProjectBridge | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}

	return window.projectBridge ?? createBrowserProjectBridge();
}

function findNode(node: ProjectNode | undefined, targetPath: string): ProjectNode | null {
	if (!node) {
		return null;
	}

	if (node.path === targetPath) {
		return node;
	}

	if (node.kind !== "directory" || !node.children) {
		return null;
	}

	for (const child of node.children) {
		const match = findNode(child, targetPath);
		if (match) {
			return match;
		}
	}

	return null;
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

function getDefaultExpandedPaths(snapshot: ProjectSnapshot): Set<string> {
	const expanded = new Set<string>([snapshot.rootPath]);
	const firstLevelFolders = snapshot.tree.children?.filter(
		(child) => child.kind === "directory",
	);
	for (const folder of firstLevelFolders ?? []) {
		expanded.add(folder.path);
	}
	return expanded;
}

function isSameOrDescendantPath(targetPath: string, parentPath: string) {
	return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
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
	const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(new Set());
	const [activeFile, setActiveFile] = React.useState<ActiveFileState | null>(null);
	const [pendingCreate, setPendingCreate] = React.useState<PendingCreateState | null>(
		null,
	);
	const [renamingPath, setRenamingPath] = React.useState<string | null>(null);
	const [isBusy, setIsBusy] = React.useState(false);

	React.useEffect(() => {
		if (!project) {
			setExpandedPaths(new Set());
			setSelectedPath(null);
			setActiveFile(null);
			return;
		}

		setExpandedPaths((current) => {
			if (current.size > 0) {
				return new Set([...current, project.rootPath]);
			}
			return getDefaultExpandedPaths(project);
		});
		setSelectedPath((current) => current ?? project.rootPath);
	}, [project]);

	const selectedNode = React.useMemo(
		() => findNode(project?.tree, selectedPath ?? ""),
		[project, selectedPath],
	);

	const applyProjectSnapshot = React.useCallback(
		(nextProject: ProjectSnapshot, preferredPath?: string | null) => {
			setProject(nextProject);
			setExpandedPaths((current) => {
				const nextExpanded =
					current.size > 0 ? new Set(current) : getDefaultExpandedPaths(nextProject);
				nextExpanded.add(nextProject.rootPath);
				for (const ancestor of getAncestorPaths(
					preferredPath ?? nextProject.rootPath,
					nextProject.rootPath,
				)) {
					nextExpanded.add(ancestor);
				}
				return nextExpanded;
			});
			setSelectedPath(preferredPath ?? nextProject.rootPath);
		},
		[setProject],
	);

	const openProjectFolder = React.useCallback(async () => {
		if (!projectBridge) {
			setError(FALLBACK_PERMISSIONS.message ?? "Project access is unavailable.");
			return;
		}

		setIsBusy(true);
		setError(null);
		try {
			const openedProject = await projectBridge.openProjectFolder();
			if (openedProject) {
				applyProjectSnapshot(openedProject, openedProject.rootPath);
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
	}, [applyProjectSnapshot, projectBridge, setError]);

	const refreshProject = React.useCallback(
		async (preferredPath?: string | null) => {
			if (!projectBridge || !project) {
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const refreshedProject = await projectBridge.refreshProject(project.rootPath);
				applyProjectSnapshot(
					refreshedProject,
					preferredPath ?? selectedPath ?? refreshedProject.rootPath,
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
				setError(FALLBACK_PERMISSIONS.message ?? "Project access is unavailable.");
				return;
			}

			setActiveFile({
				path: node.path,
				name: node.name,
				content: "",
				savedContent: "",
				permissions: node.permissions,
				isLoading: true,
			});

			try {
				const fileResult = await projectBridge.readFile(node.path);
				setActiveFile({
					path: node.path,
					name: node.name,
					content: fileResult.content,
					savedContent: fileResult.content,
					permissions: fileResult.permissions,
					isLoading: false,
				});
			} catch (readError) {
				setActiveFile(null);
				setError(
					readError instanceof Error
						? readError.message
						: "Failed to open the selected file.",
				);
			}
		},
		[projectBridge, setError],
	);

	const updateActiveFileContent = React.useCallback((content: string) => {
		setActiveFile((current) => {
			if (!current) {
				return current;
			}

			return {
				...current,
				content,
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
			const result = await projectBridge.writeFile(activeFile.path, activeFile.content);
			setActiveFile((current) =>
				current
					? {
							...current,
							content: activeFile.content,
							savedContent: activeFile.content,
							permissions: result.permissions,
						}
					: current,
			);
			await refreshProject(activeFile.path);
		} catch (writeError) {
			setError(
				writeError instanceof Error
					? writeError.message
					: "Failed to save the active file.",
			);
		} finally {
			setIsBusy(false);
		}
	}, [activeFile, projectBridge, refreshProject, setError]);

	const beginCreate = React.useCallback(
		(kind: ProjectNodeKind, targetPath?: string) => {
			if (!project) {
				return;
			}

			const targetNode = targetPath ? findNode(project.tree, targetPath) : null;
			const parentPath =
				targetNode?.kind === "directory"
					? targetNode.path
					: targetNode?.path
						? getAncestorPaths(targetNode.path, project.rootPath).at(-1) ?? project.rootPath
						: project.rootPath;

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
				const nextProject =
					pendingCreate.kind === "file"
						? await projectBridge.createFile(pendingCreate.parentPath, trimmedName, "")
						: await projectBridge.createFolder(
								pendingCreate.parentPath,
								trimmedName,
							);

				const nextPath = `${pendingCreate.parentPath.replace(/\/$/, "")}/${trimmedName}`;
				applyProjectSnapshot(nextProject, nextPath);
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
		[applyProjectSnapshot, pendingCreate, projectBridge, setError],
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
				const nextProject = await projectBridge.renamePath(renamingPath, trimmedName);
				const parentPath = getAncestorPaths(renamingPath, project.rootPath).at(-1);
				const nextPath = parentPath
					? `${parentPath.replace(/\/$/, "")}/${trimmedName}`
					: renamingPath;

				if (activeFile?.path && isSameOrDescendantPath(activeFile.path, renamingPath)) {
					const nextActivePath = activeFile.path.replace(renamingPath, nextPath);
					setActiveFile((current) =>
						current
							? {
									...current,
									path: nextActivePath,
									name:
										current.path === renamingPath ? trimmedName : current.name,
								}
							: current,
					);
				}

				applyProjectSnapshot(nextProject, nextPath);
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
		[activeFile?.path, applyProjectSnapshot, project, projectBridge, renamingPath, setError],
	);

	const deleteNode = React.useCallback(
		async (targetPath: string) => {
			if (!projectBridge || !project) {
				return;
			}

			setIsBusy(true);
			setError(null);
			try {
				const nextProject = await projectBridge.deletePath(targetPath);
				const nextSelection =
					targetPath === project.rootPath
						? nextProject.rootPath
						: getAncestorPaths(targetPath, project.rootPath).at(-1) ??
							nextProject.rootPath;

				if (activeFile?.path && isSameOrDescendantPath(activeFile.path, targetPath)) {
					setActiveFile(null);
				}

				applyProjectSnapshot(nextProject, nextSelection);
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
		[activeFile?.path, applyProjectSnapshot, project, projectBridge, setError],
	);

	return {
		activeFile,
		beginCreate,
		beginRename,
		createNode,
		deleteNode,
		error,
		expandedPaths,
		isBootstrapping,
		isBusy,
		openNode,
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
