export function Canvas({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex bg-panel-700 border-border-500 rounded-[16px] border-t border-r border-l opacity-100 h-full min-h-0 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
