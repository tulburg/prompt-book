import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.tsx";
import AgentApp from "./agent-app.tsx";
import { MermaidViewerWindow } from "./ui/higher/MermaidViewer.tsx";
import "./index.css";
import { ApplicationSettingsProvider } from "./lib/use-application-settings";
import "monaco-editor/min/vs/editor/editor.main.css";
import "simplebar-react/dist/simplebar.min.css";

const params = new URLSearchParams(window.location.search);
const view = params.get("view");
const isAgentWindow = params.get("agent") === "1";

function Root() {
	if (view === "mermaid") {
		return <MermaidViewerWindow />;
	}

	return (
		<ApplicationSettingsProvider>
			{isAgentWindow ? <AgentApp /> : <App />}
		</ApplicationSettingsProvider>
	);
}

// biome-ignore lint/style/noNonNullAssertion: <explanation>
ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Root />
	</React.StrictMode>,
);

// Use contextBridge
window.ipcRenderer?.on("main-process-message", (_event, message) => {
	console.log(message);
});
