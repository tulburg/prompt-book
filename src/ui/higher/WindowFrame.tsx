import { ListPlus, XIcon } from "lucide-react";

export function WindowFrame({
  className,
  children,
  title,
}: {
  title?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col relative bg-panel border border-border-500 rounded-[6px] focus-within:shadow-[0px_5px_16px_4px_rgba(0,0,0,0.1)] ${className}`}
    >
      {title && (
        <div className="flex gap-2 text-foreground/70 items-center bg-panel-600/80 border-b border-border-500/80 px-4 py-1.5 rounded-t-[6px]">
          <ListPlus className="w-4 h-4" /> {title}
        </div>
      )}
      <div className="w-6 h-6 absolute top-2 right-0 group" onClick={() => 0}>
        <XIcon className="w-4 h-4 text-foreground/50 group-hover:text-foreground" />
      </div>
      {children}
    </div>
  );
}
