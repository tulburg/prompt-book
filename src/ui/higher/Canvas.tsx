import { MonacoEditor } from "@/components/editor/MonacoEditor";
import { FileIcon } from "@/components/FileIcon";
import {
  SETTINGS_EDITOR_PATH,
  type ApplicationSettingDescriptor,
  type ApplicationSettingKey,
  type ApplicationSettings,
} from "@/lib/application-settings";
import type {
  ActiveFileState,
  ProjectNode,
  ProjectSnapshot,
} from "@/lib/project-files";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/lower/Button";
import { TinyScrollArea } from "@/ui/lower/TinyScrollArea";
import {
  FileCode2,
  FolderOpen,
  Save,
  X,
} from "lucide-react";
import * as React from "react";

import { Settings } from "./Settings";

interface PromptEditorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  project: ProjectSnapshot | null;
  selectedNode: ProjectNode | null;
  activeFile: ActiveFileState | null;
  activeFilePath: string | null;
  openFiles: ActiveFileState[];
  previewFilePath: string | null;
  activeSettings: ApplicationSettings | null;
  settingsDescriptors: ApplicationSettingDescriptor[];
  settingsJson: string;
  isBusy: boolean;
  onChange: (content: string) => void;
  onActivateFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onOpenProjectFolder: () => void | Promise<void>;
  onPinFile: (path: string) => void;
  onSave: () => void | Promise<void>;
  onSettingChange: <K extends ApplicationSettingKey>(
    key: K,
    value: ApplicationSettings[K],
  ) => void;
}

export function PromptEditor({
  activeFile,
  activeFilePath,
  activeSettings,
  className,
  isBusy,
  onChange,
  onActivateFile,
  onCloseFile,
  onOpenProjectFolder,
  onPinFile,
  onSave,
  onSettingChange,
  openFiles,
  previewFilePath,
  project,
  selectedNode,
  settingsDescriptors,
  settingsJson,
}: PromptEditorProps) {
  const isDirty =
    activeFile &&
    activeFile.content !== activeFile.savedContent &&
    !activeFile.isLoading;
  const isSettingsView =
    activeFilePath === SETTINGS_EDITOR_PATH && Boolean(activeSettings);

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
        {openFiles.length > 0 ? (
          <TinyScrollArea
            direction="horizontal"
            className="border-b border-border-500 bg-panel-700"
            contentClassName="flex items-center"
          >
            {openFiles.map((file) => {
              const isActive = activeFilePath === file.path;
              const isPreview = previewFilePath === file.path;
              const isTabDirty =
                file.content !== file.savedContent && !file.isLoading;

              return (
                <div
                  key={file.path}
                  ref={(el) => {
                    if (isActive && el) {
                      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
                    }
                  }}
                  className={cn(
                    "group relative flex h-[35px] items-center gap-1.5 border-r border-border-500/50 pl-3 pr-1 text-[13px] transition-colors",
                    isActive
                      ? "bg-panel-600 text-foreground"
                      : "bg-panel-700 text-foreground/60 hover:text-foreground/80",
                  )}
                >
                  <FileIcon fileName={file.name} />
                  <button
                    type="button"
                    onClick={() => onActivateFile(file.path)}
                    onDoubleClick={() => {
                      if (isPreview) {
                        onPinFile(file.path);
                      }
                    }}
                    className="min-w-0 flex-1 text-left"
                    title={file.path}
                  >
                    <span
                      className={cn(
                        "truncate",
                        isPreview && "italic text-foreground/60",
                      )}
                    >
                      {file.name}
                    </span>
                  </button>
                  {isTabDirty ? (
                    <span className="shrink-0 text-[11px] font-medium leading-none text-foreground/40">
                      M
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      onCloseFile(file.path);
                    }}
                    className={cn(
                      "shrink-0 rounded p-0.5 transition-colors hover:bg-panel-400 hover:text-foreground/80",
                      isActive
                        ? "text-foreground/40"
                        : "text-transparent group-hover:text-foreground/30",
                    )}
                    aria-label={`Close ${file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </TinyScrollArea>
        ) : null}

        <div className="min-h-0 min-w-0 flex-1">
          {isSettingsView && activeSettings ? (
            <Settings
              descriptors={settingsDescriptors}
              jsonContent={settingsJson}
              onChange={onSettingChange}
              settings={activeSettings}
            />
          ) : !project ? (
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
