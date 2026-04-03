import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.tsx";
import "./index.css";
import { ApplicationSettingsProvider } from "./lib/use-application-settings";
import "monaco-editor/min/vs/editor/editor.main.css";
import "simplebar-react/dist/simplebar.min.css";

// biome-ignore lint/style/noNonNullAssertion: <explanation>
ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ApplicationSettingsProvider>
			<App />
		</ApplicationSettingsProvider>
	</React.StrictMode>,
);

// Use contextBridge
window.ipcRenderer?.on("main-process-message", (_event, message) => {
	console.log(message);
});
