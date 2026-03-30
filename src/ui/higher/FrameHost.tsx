import type { ReactNode } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "frame-host-layout";

export interface FramePanelConfig {
  id: string;
  children: ReactNode;
  minSize?: number;
  defaultSize?: number;
  className?: string;
}

export interface FrameHostProps {
  id?: string;
  panels: FramePanelConfig[];
  className?: string;
  storageKey?: string;
}

export function FrameHost({
  id = "frame-host",
  panels,
  className,
  storageKey = STORAGE_KEY,
}: FrameHostProps) {
  const storageId = `${storageKey}-${id}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: storageId,
    storage: typeof window !== "undefined" ? localStorage : undefined,
    panelIds: panels.map((p) => p.id),
  });

  const elements: React.ReactNode[] = [];
  for (let i = 0; i < panels.length; i++) {
    if (i > 0) {
      elements.push(
        <Separator
          key={`separator-${panels[i].id}`}
          className="resize-handle"
        />,
      );
    }
    const panel = panels[i];
    elements.push(
      <Panel
        key={panel.id}
        id={panel.id}
        defaultSize={panel.defaultSize ?? 100 / panels.length}
        minSize={panel.minSize ?? 10}
        className={cn("h-full overflow-hidden px-1", panel.className)}
      >
        <div className="h-full min-h-0">{panel.children}</div>
      </Panel>,
    );
  }

  return (
    <Group
      id={id}
      data-testid={id}
      className={cn("h-full w-full pl-1 pb-2 pr-1", className)}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {elements}
    </Group>
  );
}
