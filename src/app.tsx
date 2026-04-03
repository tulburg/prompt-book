import {
	SETTINGS_EDITOR_PATH,
} from "@/lib/application-settings";
import Bus from "@/lib/bus";
import { useGitStatus } from "@/lib/use-git-status";
import { useApplicationSettings } from "@/lib/use-application-settings";
import { useProjectManager } from "@/lib/use-project-manager";
import type { ProjectNode } from "@/lib/project-files";
import { ChatPanel, FrameHost, Header, PromptEditor, Sidebar } from "@/ui";
import * as React from "react";

export default function App() {
	const projectManager = useProjectManager();
	const applicationSettings = useApplicationSettings();
	const settings = applicationSettings.settings;
	const gitStatus = useGitStatus(
		projectManager.project,
		projectManager.projectBridge,
	);
	const isSidebarVisible = settings?.["workbench.sidebar.visible"] ?? true;
	const sidebarSortOrder =
		settings?.["workbench.sidebar.sortOrder"] ?? "default";
	const enableCompactFolders = settings?.["explorer.compactFolders"] ?? true;
	const enableFileNesting =
		settings?.["explorer.fileNesting.enabled"] ?? true;
	const autoReveal = settings?.["explorer.autoReveal"] ?? true;

	React.useEffect(() => {
		const handleSidebarToggle = () => {
			if (!settings) {
				return;
			}

			applicationSettings.updateSetting(
				"workbench.sidebar.visible",
				!settings["workbench.sidebar.visible"],
			);
		};

		Bus.on("sidebar:toggle", handleSidebarToggle);

		return () => {
			Bus.off("sidebar:toggle", handleSidebarToggle);
		};
	}, [applicationSettings.updateSetting, settings]);

	const openFiles = React.useMemo(() => {
		if (
			applicationSettings.isSettingsOpen &&
			applicationSettings.activeSettingsFile
		) {
			return [
				...projectManager.openFiles,
				applicationSettings.activeSettingsFile,
			];
		}

		return projectManager.openFiles;
	}, [
		applicationSettings.activeSettingsFile,
		applicationSettings.isSettingsOpen,
		projectManager.openFiles,
	]);

	const activeFile = applicationSettings.isSettingsActive
		? applicationSettings.activeSettingsFile
		: projectManager.activeFile;
	const activeFilePath = applicationSettings.isSettingsActive
		? SETTINGS_EDITOR_PATH
		: projectManager.activeFilePath;

	const handleActivateFile = React.useCallback(
		(path: string) => {
			if (path === SETTINGS_EDITOR_PATH) {
				applicationSettings.activateSettings();
				return;
			}

			applicationSettings.deactivateSettings();
			projectManager.activateFile(path);
		},
		[applicationSettings, projectManager],
	);

	const handleCloseFile = React.useCallback(
		(path: string) => {
			if (path === SETTINGS_EDITOR_PATH) {
				applicationSettings.closeSettings();
				return;
			}

			projectManager.closeFile(path);
		},
		[applicationSettings, projectManager],
	);

	const handlePinFile = React.useCallback(
		(path: string) => {
			if (path === SETTINGS_EDITOR_PATH) {
				applicationSettings.activateSettings();
				return;
			}

			applicationSettings.deactivateSettings();
			projectManager.pinFile(path);
		},
		[applicationSettings, projectManager],
	);

	const handleOpenNode = React.useCallback(
		async (node: ProjectNode) => {
			applicationSettings.deactivateSettings();
			await projectManager.openNode(node);
		},
		[applicationSettings, projectManager],
	);

	const handlePreviewNode = React.useCallback(
		async (node: ProjectNode) => {
			applicationSettings.deactivateSettings();
			await projectManager.previewNode(node);
		},
		[applicationSettings, projectManager],
	);

	const handleSave = React.useCallback(async () => {
		if (activeFilePath === SETTINGS_EDITOR_PATH) {
			await applicationSettings.saveSettings();
			return;
		}

		await projectManager.saveActiveFile();
	}, [activeFilePath, applicationSettings, projectManager]);

	const handleOpenFileAtLine = React.useCallback(
		async (path: string, line: number) => {
			applicationSettings.deactivateSettings();
			await projectManager.openFileAtLine(path, line);
		},
		[applicationSettings, projectManager],
	);

	return (
		<div className="bg-panel flex h-screen w-screen flex-col">
			<Header />
			<FrameHost
				id="main-layout"
				storageKey="prompt-book-layout"
				className="h-screen w-screen"
				panels={[
					...(isSidebarVisible
						? [
								{
									id: "sidebar",
									minSize: 150,
									defaultSize: 12,
									children: (
										<Sidebar
											activeFilePath={activeFilePath}
											autoReveal={autoReveal}
											enableCompactFolders={enableCompactFolders}
											enableFileNesting={enableFileNesting}
											error={projectManager.error}
											expandedPaths={projectManager.expandedPaths}
											gitStatus={gitStatus}
											isBusy={
												projectManager.isBusy || projectManager.isBootstrapping
											}
											onBeginCreate={projectManager.beginCreate}
											onBeginRename={projectManager.beginRename}
											onCancelInlineState={() => {
												projectManager.setPendingCreate(null);
												projectManager.setRenamingPath(null);
											}}
											onCopyNode={projectManager.copyNode}
											onCreateNode={projectManager.createNode}
											onDeleteNode={projectManager.deleteNode}
											onMoveNode={projectManager.moveNode}
											onOpenNode={handleOpenNode}
											onPreviewNode={handlePreviewNode}
											onOpenProjectFolder={projectManager.openProjectFolder}
											onRefresh={() => projectManager.refreshProject()}
											onRenameNode={projectManager.renameNode}
											onRevealPath={projectManager.revealPath}
											onSelectNode={projectManager.selectNode}
											pendingCreate={projectManager.pendingCreate}
											project={projectManager.project}
											renamingPath={projectManager.renamingPath}
											selectedPath={projectManager.selectedPath}
											sortOrder={sidebarSortOrder}
										/>
									),
								},
							]
						: []),
					{
						id: "editor",
						minSize: 250,
						defaultSize: 45,
						children: (
							<PromptEditor
								activeFile={activeFile}
								activeFilePath={activeFilePath}
								activeSettings={applicationSettings.settings}
								editorNavigationTarget={projectManager.editorNavigationTarget}
								isBusy={projectManager.isBusy}
								onChange={projectManager.updateActiveFileContent}
								onActivateFile={handleActivateFile}
								onCloseFile={handleCloseFile}
								onOpenProjectFolder={projectManager.openProjectFolder}
								onPinFile={handlePinFile}
								onSave={handleSave}
								onSettingChange={applicationSettings.updateSetting}
								openFiles={openFiles}
								previewFilePath={projectManager.previewFilePath}
								project={projectManager.project}
								selectedNode={projectManager.selectedNode}
								settingsDescriptors={applicationSettings.settingDescriptors}
								settingsJson={applicationSettings.settingsJson}
							/>
						),
					},
					{
						id: "chat",
						minSize: 200,
						defaultSize: 25,
						children: (
							<ChatPanel onOpenFileAtLine={handleOpenFileAtLine} />
						),
					},
				]}
			/>
		</div>
	);
}
