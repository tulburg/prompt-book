/// <reference types="vite/client" />

import type { NativeContextMenuBridge } from "@/lib/native-context-menu";
import type { SettingsBridge } from "@/lib/application-settings";
import type { ProjectBridge } from "@/lib/project-files";

declare global {
	interface Window {
		ipcRenderer?: {
			on: (
				channel: string,
				listener: (event: unknown, ...args: unknown[]) => void,
			) => unknown;
		};
		MonacoEnvironment?: {
			getWorker: (workerId: string, label: string) => Worker;
		};
		nativeContextMenu?: NativeContextMenuBridge;
		projectBridge?: ProjectBridge;
		settingsBridge?: SettingsBridge;
	}
}
