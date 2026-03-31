import * as React from "react";
import { PromptEditor, ExplorerPanel, FrameHost, Header, Sidebar } from "@/ui";
import Bus from "@/lib/bus";
import { useGitStatus } from "@/lib/use-git-status";
import { useProjectManager } from "@/lib/use-project-manager";

export default function App() {
  const projectManager = useProjectManager();
  const gitStatus = useGitStatus(projectManager.project, projectManager.projectBridge);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);

  React.useEffect(() => {
    const handleSidebarToggle = () => {
      setSidebarOpen((current) => !current);
    };

    Bus.on("sidebar:toggle", handleSidebarToggle);

    return () => {
      Bus.off("sidebar:toggle", handleSidebarToggle);
    };
  }, []);

  return (
    <div className="bg-panel flex h-screen w-screen flex-col">
      <Header />
      <FrameHost
        id="main-layout"
        storageKey="prompt-book-layout"
        className="h-screen w-screen"
        panels={[
          ...(sidebarOpen
            ? [
                {
                  id: "sidebar",
                  minSize: 150,
                  defaultSize: 12,
                  children: (
                    <Sidebar
                      error={projectManager.error}
                      expandedPaths={projectManager.expandedPaths}
                      gitStatus={gitStatus}
                      isBusy={projectManager.isBusy || projectManager.isBootstrapping}
                      onBeginCreate={projectManager.beginCreate}
                      onBeginRename={projectManager.beginRename}
                      onCancelInlineState={() => {
                        projectManager.setPendingCreate(null);
                        projectManager.setRenamingPath(null);
                      }}
                      onCreateNode={projectManager.createNode}
                      onDeleteNode={projectManager.deleteNode}
                      onOpenNode={projectManager.openNode}
                      onOpenProjectFolder={projectManager.openProjectFolder}
                      onRefresh={() => projectManager.refreshProject()}
                      onRenameNode={projectManager.renameNode}
                      onSelectNode={projectManager.selectNode}
                      pendingCreate={projectManager.pendingCreate}
                      project={projectManager.project}
                      renamingPath={projectManager.renamingPath}
                      selectedPath={projectManager.selectedPath}
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
                activeFile={projectManager.activeFile}
                isBusy={projectManager.isBusy}
                onChange={projectManager.updateActiveFileContent}
                onOpenProjectFolder={projectManager.openProjectFolder}
                onSave={projectManager.saveActiveFile}
                project={projectManager.project}
                selectedNode={projectManager.selectedNode}
              />
            ),
          },
          {
            id: "explorer",
            minSize: 100,
            defaultSize: 15,
            children: (
              <ExplorerPanel
                isBusy={projectManager.isBusy}
                onBeginCreate={projectManager.beginCreate}
                onBeginRename={projectManager.beginRename}
                onDeleteNode={projectManager.deleteNode}
                onOpenProjectFolder={projectManager.openProjectFolder}
                onRefresh={() => projectManager.refreshProject()}
                project={projectManager.project}
                selectedNode={projectManager.selectedNode}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
