import type { BrowserWindow } from "electron";
import { registerProjectHandlers } from "./project-handlers";
import { registerSettingsHandlers } from "./settings-handlers";
import { registerGitHandlers } from "./git-handlers";
import { registerUiHandlers } from "./ui-handlers";
import { registerLmsHandlers } from "./handlers";
import { registerChatToolHandlers } from "./chat-tools-handlers";

export { killLmsServer } from "./handlers";
export { store } from "./shared";

export function registerAllHandlers(win: BrowserWindow | null) {
  registerProjectHandlers(win);
  registerSettingsHandlers();
  registerGitHandlers();
  registerChatToolHandlers();
  registerUiHandlers(win);
  registerLmsHandlers();
}
