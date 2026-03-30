export function Title({ children }: React.PropsWithChildren) {
  return (
    <h1 className="text-foreground-900 text-[12px] font-semibold uppercase">
      {children}
    </h1>
  );
}
