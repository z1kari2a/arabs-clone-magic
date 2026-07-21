// Standalone Vite config used to build the Electron (file://) bundle.
// The main `vite.config.ts` builds the SSR/web preview via TanStack Start.
// This config builds a plain SPA (CSR) rooted at electron-app/index.html.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  root: path.resolve(process.cwd(), "electron-app"),
  base: "./",
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist-electron"),
    emptyOutDir: true,
  },
});