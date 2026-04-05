import { buildEffectiveSystemPrompt } from "./system-prompt";
import type { ChatQueryContext, ChatSessionState } from "./types";

export interface BuildQueryContextOptions {
	session: ChatSessionState;
	platform?: string;
	now?: Date;
	appendSystemPrompt?: string;
	overrideSystemPrompt?: string | null;
	workspaceRoots?: string[];
}

export function buildQueryContext({
	session,
	platform = navigator.platform || "unknown",
	now = new Date(),
	appendSystemPrompt,
	overrideSystemPrompt,
	workspaceRoots = [],
}: BuildQueryContextOptions): ChatQueryContext {
	const primaryWorkspaceRoot = workspaceRoots[0];
	return {
		systemPrompt: buildEffectiveSystemPrompt({
			mode: session.mode,
			appendSystemPrompt,
			overrideSystemPrompt,
		}),
		userContext: {
			mode: session.mode,
			platform,
			sessionId: session.id,
			sessionTitle: session.title,
		},
		systemContext: {
			date: now.toISOString(),
			model: session.modelId ?? "default",
			bootstrappedAt: new Date(session.bootstrappedAt).toISOString(),
			workspaceRoot: primaryWorkspaceRoot ?? "",
			workspaceRoots: workspaceRoots.join(", "),
		},
	};
}
