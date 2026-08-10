// Standalone Vite config used to build the Electron (file://) bundle.
// The main `vite.config.ts` builds the SSR/web preview via TanStack Start.
// This config builds a plain SPA (CSR) rooted at electron-app/index.html.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

// The desktop build has no server: `src/routes/api/**` (license endpoints) and
// `admin.licenses.tsx` both pull in `@tanstack/react-start`, whose
// `#tanstack-start-entry` import only resolves inside a Start SSR build. So we
// generate a SECOND route tree that simply omits those routes, and the Electron
// entry imports that one instead of `src/routeTree.gen.ts`.
// The generator matches this against each dirent's *basename* (not its path),
// so `^api$` drops the whole src/routes/api directory.
const SERVER_ONLY_ROUTES = "(^api$|^admin\\.licenses)";

export default defineConfig({
  root: path.resolve(process.cwd(), "electron-app"),
  base: "./",
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: path.resolve(process.cwd(), "src/routes"),
      generatedRouteTree: path.resolve(process.cwd(), "src/routeTree.electron.gen.ts"),
      routeFileIgnorePattern: SERVER_ONLY_ROUTES,
      autoCodeSplitting: false,
      quoteStyle: "double",
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  // Lets shared code (src/routes/__root.tsx) drop anything that assumes a
  // server or a network — the web build leaves this undefined.
  define: {
    "import.meta.env.VITE_DESKTOP": JSON.stringify("true"),
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist-electron"),
    emptyOutDir: true,
    // A local file:// app is never fetched over the network — readable stack
    // traces on a customer machine are worth more than the extra megabytes.
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
