export function Sidebar({ className }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-col bg-panel p-10 h-full ${className ?? ""}`}>
      Sidebar
    </div>
  );
}
