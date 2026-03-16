import { Canvas, ExplorerPanel, FrameHost, Sidebar, WindowFrame } from "@/ui";
import PromptBox from "./components/PromptBox";

export default function App() {
  return (
    <div className="bg-panel flex h-screen w-screen">
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
              <Canvas className="p-20">
                <WindowFrame
                  title="Login page"
                  className="w-[400px] overflow-hidden rounded-[8px]"
                >
                  <div className="flex flex-col justify-end h-[calc(100vh-100px)]">
                    <div className="p-2">
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
