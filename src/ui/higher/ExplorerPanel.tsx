export function ExplorerPanel({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-panel-700 rounded-[16px] flex flex-col bg-panel border-r border-border-500 p-4 h-full ${className ?? ""}`}
    >
      <div className="text-foreground/70 text-sm font-medium mb-3">
        Explorer
      </div>
      <div className="text-foreground/50 text-xs">File tree placeholder</div>
    </div>
  );
}
