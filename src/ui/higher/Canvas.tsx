import { Title } from "../lower/Typography";

export function PromptEditor({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`grid grid-cols-[1fr_300px] bg-panel-700 rounded-[16px] opacity-100 h-full min-h-0 ${className ?? ""}`}
    >
      <div className="flex"></div>
      <div className="flex border-l border-border-500 p-6">
        <Title>Resources</Title>
      </div>
    </div>
  );
}
