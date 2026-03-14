import React from "react";
import ReactDOM from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles/globals.css";
import { StudioApp } from "./editor/StudioApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <StudioApp />
    </ReactFlowProvider>
  </React.StrictMode>,
);
