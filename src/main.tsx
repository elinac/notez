import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDiagramZoomGlobalBridge } from "./components/diagramZoom";
import { installDiagramCopyGlobalBridge } from "./components/diagramCopy";
import { installNativeChromeGuards } from "./utils/nativeChrome";

installDiagramZoomGlobalBridge();
installDiagramCopyGlobalBridge();
installNativeChromeGuards();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
