import { PromptEditor, ExplorerPanel, FrameHost, Header, Sidebar } from "@/ui";

export default function App() {
  return (
    <div className="bg-panel flex h-screen w-screen flex-col">
      <Header />
      <FrameHost
        id="main-layout"
        storageKey="prompt-book-layout"
        className="h-screen w-screen"
        panels={[
          {
            id: "sidebar",
            minSize: 150,
            defaultSize: 12,
            children: <Sidebar />,
          },
          {
            id: "editor",
            minSize: 250,
            defaultSize: 45,
            children: <PromptEditor />,
          },
          {
            id: "explorer",
            minSize: 100,
            defaultSize: 15,
            children: <ExplorerPanel />,
          },
        ]}
      />
    </div>
  );
}
