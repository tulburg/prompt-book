import * as React from "react";
import type { GitStatusMap, ProjectBridge, ProjectSnapshot } from "@/lib/project-files";

const POLL_INTERVAL_MS = 3000;

export function useGitStatus(
	project: ProjectSnapshot | null,
	projectBridge: ProjectBridge | undefined,
) {
	const [gitStatus, setGitStatus] = React.useState<GitStatusMap>({});

	const fetchStatus = React.useCallback(async () => {
		if (!project || !projectBridge?.gitStatus) {
			setGitStatus({});
			return;
		}

		const merged: GitStatusMap = {};
		for (const root of project.roots) {
			const result = await projectBridge.gitStatus(root.path);
			if (result) {
				Object.assign(merged, result);
			}
		}

		setGitStatus(merged);
	}, [project, projectBridge]);

	React.useEffect(() => {
		void fetchStatus();
		const interval = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [fetchStatus]);

	return gitStatus;
}
