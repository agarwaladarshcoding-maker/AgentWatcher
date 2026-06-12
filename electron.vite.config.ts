import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// electron-vite wires the three sides of the app:
//   main    -> src/main/index.ts      (Node: owns PTY, interpreter, SQLite)
//   preload -> src/preload/index.ts    (the only bridge that crosses to the renderer)
//   renderer-> src/renderer/index.html (React UI)
//
// Native deps (node-pty, better-sqlite3) and other node deps must stay external
// so they are required at runtime rather than bundled. externalizeDepsPlugin
// handles that from package.json dependencies.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["strip-ansi"] })],
    build: {
      lib: {
        entry: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
      },
    },
  },
});
