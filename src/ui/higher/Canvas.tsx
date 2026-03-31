import { FileCode2, FolderOpen, Save } from "lucide-react";
import { MonacoEditor } from "@/components/editor/MonacoEditor";
import type {
  ActiveFileState,
  ProjectNode,
  ProjectSnapshot,
} from "@/lib/project-files";
import { Button } from "@/ui/lower/Button";

interface PromptEditorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  project: ProjectSnapshot | null;
  selectedNode: ProjectNode | null;
  activeFile: ActiveFileState | null;
  isBusy: boolean;
  onChange: (content: string) => void;
  onOpenProjectFolder: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
}

export function PromptEditor({
  activeFile,
  className,
  isBusy,
  onChange,
  onOpenProjectFolder,
  onSave,
  project,
  selectedNode,
}: PromptEditorProps) {
  const isDirty =
    activeFile &&
    activeFile.content !== activeFile.savedContent &&
    !activeFile.isLoading;

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 rounded-[16px] bg-panel-700 ${className ?? ""}`}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border-500 px-5 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/45">
              Editor
            </div>
            <div className="truncate text-sm font-medium text-foreground">
              {activeFile?.name ?? selectedNode?.name ?? "No file selected"}
            </div>
          </div>
          {activeFile ? (
            <Button disabled={!isDirty || isBusy} onClick={() => void onSave()}>
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 min-w-0 flex-1">
          {!project ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="rounded-full border border-border-500 bg-panel-600 p-4">
                <FolderOpen className="h-8 w-8 text-foreground/70" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  Start with a project folder
                </div>
                <div className="mt-1 text-xs leading-5 text-foreground/55">
                  Open an initial folder to load the file tree and begin
                  editing.
                </div>
              </div>
              <Button onClick={() => void onOpenProjectFolder()}>
                Open Project Folder
              </Button>
            </div>
          ) : activeFile ? (
            activeFile.isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-foreground/60">
                Loading file contents...
              </div>
            ) : (
              <MonacoEditor
                activeFile={activeFile}
                onChange={onChange}
                onSave={onSave}
                className="z-[1]"
              />
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
              <div className="rounded-full border border-border-500 bg-panel-600 p-4">
                <FileCode2 className="h-8 w-8 text-foreground/70" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {selectedNode?.kind === "directory"
                    ? "Pick a file from the folder tree"
                    : "Choose a file to edit"}
                </div>
                <div className="mt-1 text-xs leading-5 text-foreground/55">
                  File creation, folder creation, rename, delete, and open
                  actions are all available directly from the sidebar.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
