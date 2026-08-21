import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveBookmarkForTest, useAppStore } from "./store";
import "./styles.css";

const root = document.querySelector("#app");
if (!root) throw new Error("#app not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

window.__MDV_OPEN_DOCUMENT__ = async (path: string) => {
  await useAppStore.getState().openDocument(path);
};
window.__MDV_MENU_COMMAND__ = async (command: string) => {
  window.dispatchEvent(new CustomEvent("mdv:test-menu-command", { detail: command }));
};
window.__MDV_RESOLVE_BOOKMARK__ = resolveBookmarkForTest;
