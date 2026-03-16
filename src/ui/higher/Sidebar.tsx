export function Sidebar({ className }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex bg-panel w-[320px] border-r border-border-500 p-10 ${className}`}
    >
      Sidebar
    </div>
  );
}
