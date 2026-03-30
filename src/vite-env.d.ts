/// <reference types="vite/client" />

import type { ProjectBridge } from "@/lib/project-files";

declare global {
	interface Window {
		projectBridge?: ProjectBridge;
	}
}
