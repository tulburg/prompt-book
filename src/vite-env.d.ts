/// <reference types="vite/client" />

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
		projectBridge?: ProjectBridge;
	}
}
