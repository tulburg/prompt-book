/// <reference types="vite/client" />

import type { NativeContextMenuBridge } from "@/lib/native-context-menu";
import type { DownloadedModelArtifact, PullProgressEvent } from "@/lib/model-downloads";
import type { SettingsBridge } from "@/lib/application-settings";
import type { ProjectBridge } from "@/lib/project-files";

declare global {
	interface Window {
		ipcRenderer: {
			on: (
				channel: string,
				listener: (event: unknown, ...args: unknown[]) => void,
			) => unknown;
			off: (
				channel: string,
				listener: (...args: unknown[]) => void,
			) => unknown;
			send: (channel: string, ...args: unknown[]) => void;
			invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
		};
		MonacoEnvironment?: {
			getWorker: (workerId: string, label: string) => Worker;
		};
		nativeContextMenu?: NativeContextMenuBridge;
		projectBridge?: ProjectBridge;
		settingsBridge?: SettingsBridge;
		llamaBridge?: {
			isBinaryInstalled: () => Promise<boolean>;
			downloadBinary: () => Promise<void>;
			downloadModel: (modelId: string) => Promise<DownloadedModelArtifact>;
			cancelDownloadModel: (modelId: string) => Promise<void>;
			onDownloadProgress: (listener: (data: PullProgressEvent) => void) => () => void;
			startServer: (serverUrl: string) => Promise<void>;
			stopServer: () => Promise<void>;
		};
	}
}
