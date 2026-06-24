import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDiagramZoomGlobalBridge } from "./components/diagramZoom";
import { installNativeChromeGuards } from "./utils/nativeChrome";

installDiagramZoomGlobalBridge();
installNativeChromeGuards();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
