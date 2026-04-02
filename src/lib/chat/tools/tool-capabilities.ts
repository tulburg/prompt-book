import type { ChatModelProfile } from "@/lib/chat/model-profiles";

export function supportsNativeToolCalling(profile: ChatModelProfile): boolean {
	return profile.nativeToolCalling === "supported";
}
