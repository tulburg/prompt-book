export function Sidebar({ className }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-panel-700 flex flex-col bg-panel p-10 rounded-[16px] h-full ${className ?? ""}`}
    >
      Sidebar
    </div>
  );
}
