import {
  Search,
  Menu,
  Settings,
  Sidebar as SidebarIcon,
  X,
} from "lucide-react";
import * as React from "react";
import Bus from "@/lib/bus";

import { Button } from "./Button";

export function Header() {
  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
    }
  };

  const isElectron = typeof window !== "undefined" && "ipcRenderer" in window;
  const dragRegionClass = isElectron ? "electron-drag-region" : "";
  const noDragClass = isElectron ? "electron-no-drag" : "";

  return (
    <div
      className={`h-12 bg-panel flex items-center justify-between px-3 select-none pl-20 ${dragRegionClass}`}
    >
      <div className={`flex items-center gap-1 ${noDragClass}`}>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Toggle sidebar"
          onClick={() => Bus.emit("sidebar:toggle", undefined)}
        >
          <SidebarIcon className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7">
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      <div className={`flex-1 max-w-md mx-4 ${noDragClass}`}>
        <div className="relative flex items-center px-1 bg-panel-600 border border-border-500 rounded-full focus-within:outline-none focus-within:border-highlight">
          <Search className="h-4 w-4 ml-1 text-foreground/50" />
          <input
            type="text"
            placeholder="Search..."
            className="w-full h-8 px-2 text-sm text-foreground placeholder:text-placeholder outline-none"
            onKeyDown={handleSearch}
          />
          <div className="text-xs text-foreground/40 border border-border-500 rounded-full px-1.5 py-0.5">
            ⌘K
          </div>
        </div>
      </div>

      <div className={`flex items-center gap-1 ${noDragClass}`}>
        <Button size="icon" variant="ghost" className="h-7 w-7">
          <Settings className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
