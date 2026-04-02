import { ipcMain, BrowserWindow, Menu } from "electron";
import type { NativeContextMenuRequest } from "../../src/lib/native-context-menu";

export function registerUiHandlers(win: BrowserWindow | null) {
  ipcMain.handle(
    "ui:show-native-context-menu",
    async (event, request: NativeContextMenuRequest) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? win;
      if (!targetWindow) {
        return null;
      }

      return await new Promise<string | null>((resolve) => {
        let settled = false;
        const settle = (actionId: string | null) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(actionId);
        };

        const menu = Menu.buildFromTemplate(
          request.items.map((item) => {
            if (item.type === "separator") {
              return { type: "separator" as const };
            }

            return {
              accelerator: item.accelerator,
              click: () => settle(item.id),
              enabled: item.enabled ?? true,
              label: item.label,
            };
          }),
        );

        menu.popup({
          callback: () => settle(null),
          window: targetWindow,
          x: typeof request.x === "number" ? Math.floor(request.x) : undefined,
          y: typeof request.y === "number" ? Math.floor(request.y) : undefined,
        });
      });
    },
  );
}
