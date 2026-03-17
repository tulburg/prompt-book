import { Canvas, ExplorerPanel, FrameHost, Header, Sidebar, WindowFrame } from "@/ui";
import PromptBox from "./components/PromptBox";

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
            id: "canvas",
            minSize: 250,
            defaultSize: 45,
            children: (
              <Canvas className="p-10">
                <WindowFrame
                  title="Login page"
                  className="overflow-hidden rounded-[8px]"
                >
                  <div className="flex flex-col justify-end h-screen">
                    <div className="p-4 w-[520px]">
                      <PromptBox />
                    </div>
                  </div>
                </WindowFrame>
              </Canvas>
            ),
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
