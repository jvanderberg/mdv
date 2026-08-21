import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export const webkitBuildTarget = "safari13";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    target: webkitBuildTarget,
    cssTarget: webkitBuildTarget,
    outDir: "src-tauri/frontend-dist",
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
    port: 1420,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
