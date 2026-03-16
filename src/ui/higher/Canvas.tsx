export function Canvas({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex bg-[#101010] border-border-500 border-r border-l opacity-100 bg-[radial-gradient(#191919_1.55px,transparent_1.55px),radial-gradient(#191919_1.55px,#101010_1.55px)] bg-[62px_62px] bg-[0_0,31px_31px] p-10 h-full min-h-0 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
