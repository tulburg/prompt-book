export default function PromptBox() {
  return (
    <div className="flex border border-border-500 bg-panel-400/80 rounded-[6px] h-[120px] focus:border-[0.5px] focus-within:border-sky/50">
      <textarea
        className="w-full h-full px-4 py-3 bg-transparent placeholder:text-zinc-500/50 outline-none resize-none"
        placeholder="Describe what to build..."
      ></textarea>
    </div>
  );
}
