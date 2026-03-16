import { Button, Sidebar, Canvas, WindowFrame } from "@/ui";
import PromptBox from "./components/PromptBox";
export default function App() {
  return (
    <div className="bg-panel flex h-screen w-screen items-center justify-center">
      <Sidebar className="fixed h-screen left-0 top-0" />
      <Canvas className="relative w-full h-screen p-20 left-[320px]">
        <WindowFrame
          title="Login page"
          className="w-[400px] overflow-hidden rounded-[8px]"
        >
          <div className="flex flex-col justify-end h-[calc(100vh-100px)] ">
            <div className="p-2">
              <PromptBox />
            </div>
          </div>
        </WindowFrame>
        {/* <Button onClick={() => 0} data-testid="random-button">
          Click me!
          </Button> */}
      </Canvas>
    </div>
  );
}
