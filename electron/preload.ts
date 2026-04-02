import { ipcRenderer, contextBridge } from 'electron'
import type { ApplicationSettings } from '../src/lib/application-settings'
import type { PullProgressEvent } from '../src/lib/model-downloads'
import type { NativeContextMenuRequest } from '../src/lib/native-context-menu'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld("projectBridge", {
  restoreLastProject: () => ipcRenderer.invoke("project:restore-last"),
  openProjectFolder: () => ipcRenderer.invoke("project:open-folder"),
  refreshProject: () => ipcRenderer.invoke("project:refresh"),
  listDirectory: (directoryPath: string) =>
    ipcRenderer.invoke("project:list-directory", directoryPath),
  readFile: (filePath: string) => ipcRenderer.invoke("project:read-file", filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("project:write-file", filePath, content),
  createFile: (parentPath: string, name: string, content?: string) =>
    ipcRenderer.invoke("project:create-file", parentPath, name, content),
  createFolder: (parentPath: string, name: string) =>
    ipcRenderer.invoke("project:create-folder", parentPath, name),
  copyPath: (sourcePath: string, targetDirectoryPath: string) =>
    ipcRenderer.invoke("project:copy-path", sourcePath, targetDirectoryPath),
  renamePath: (targetPath: string, nextName: string) =>
    ipcRenderer.invoke("project:rename-path", targetPath, nextName),
  deletePath: (targetPath: string) =>
    ipcRenderer.invoke("project:delete-path", targetPath),
  movePath: (sourcePath: string, targetDirectoryPath: string) =>
    ipcRenderer.invoke("project:move-path", sourcePath, targetDirectoryPath),
  gitStatus: (rootPath: string) =>
    ipcRenderer.invoke("git:status", rootPath),
})

contextBridge.exposeInMainWorld("settingsBridge", {
  load: () => ipcRenderer.invoke("app-settings:load"),
  save: (settings: ApplicationSettings) =>
    ipcRenderer.invoke("app-settings:save", settings),
  onOpenRequested: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on("app:open-settings", handler)
    return () => {
      ipcRenderer.off("app:open-settings", handler)
    }
  },
})

contextBridge.exposeInMainWorld("nativeContextMenu", {
  showMenu: (request: NativeContextMenuRequest) =>
    ipcRenderer.invoke("ui:show-native-context-menu", request),
})

contextBridge.exposeInMainWorld("llamaBridge", {
  isBinaryInstalled: () => ipcRenderer.invoke("llama:is-binary-installed"),
  downloadBinary: () => ipcRenderer.invoke("llama:download-binary"),
  downloadModel: (modelId: string) => ipcRenderer.invoke("llama:download-model", modelId),
  cancelDownloadModel: (modelId: string) => ipcRenderer.invoke("llama:cancel-download-model", modelId),
  onDownloadProgress: (listener: (data: PullProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: PullProgressEvent) => listener(data)
    ipcRenderer.on("llama:download-progress", handler)
    return () => { ipcRenderer.off("llama:download-progress", handler) }
  },
  startServer: (serverUrl: string) => ipcRenderer.invoke("llama:start-server", serverUrl),
  stopServer: () => ipcRenderer.invoke("llama:stop-server"),
})
