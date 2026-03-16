import React from "react";
import ReactDOM from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles/globals.css";
import { StudioAuthProvider } from "./auth/StudioAuthProvider";
import { StudioRouterProvider } from "./router";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StudioAuthProvider>
      <ReactFlowProvider>
        <StudioRouterProvider />
      </ReactFlowProvider>
    </StudioAuthProvider>
  </React.StrictMode>,
);
