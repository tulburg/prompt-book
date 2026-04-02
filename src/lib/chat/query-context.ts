import { buildEffectiveSystemPrompt } from "./system-prompt";
import type { ChatQueryContext, ChatSessionState } from "./types";

export interface BuildQueryContextOptions {
	session: ChatSessionState;
	platform?: string;
	now?: Date;
	appendSystemPrompt?: string;
	overrideSystemPrompt?: string | null;
}

export function buildQueryContext({
	session,
	platform = navigator.platform || "unknown",
	now = new Date(),
	appendSystemPrompt,
	overrideSystemPrompt,
}: BuildQueryContextOptions): ChatQueryContext {
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
		},
		systemContext: {
			date: now.toISOString(),
			model: session.modelId ?? "default",
			bootstrappedAt: new Date(session.bootstrappedAt).toISOString(),
		},
	};
}
