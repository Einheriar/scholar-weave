import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import "@/app/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");

createRoot(container).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
