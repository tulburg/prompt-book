import { ipcMain } from "electron";
import {
  sanitizeApplicationSettings,
  type ApplicationSettings,
} from "../../src/lib/application-settings";
import { store } from "./shared";

export function registerSettingsHandlers() {
  ipcMain.handle("app-settings:load", async () => {
    return sanitizeApplicationSettings(store.get("applicationSettings"));
  });

  ipcMain.handle(
    "app-settings:save",
    async (_event, nextSettings: ApplicationSettings) => {
      const sanitizedSettings = sanitizeApplicationSettings(nextSettings);
      store.set("applicationSettings", sanitizedSettings);
      return sanitizedSettings;
    },
  );
}
