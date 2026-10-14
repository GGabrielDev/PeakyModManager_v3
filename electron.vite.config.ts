import { resolve } from "path";
import { createRequire } from "node:module";

const { releaseSource } = createRequire(import.meta.url)("./scripts/release-source.cjs");
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => {
  const isBuild = command === "build";
  const esbuild = isBuild ? { pure: ["console.log"] } : undefined;

  return {
    main: {
      define: { __PMM_UPDATE_SOURCE__: JSON.stringify(releaseSource()) },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@shared": resolve("src/shared"),
          "@resources": resolve("resources"),
        },
      },
      plugins: [externalizeDepsPlugin()],
      esbuild,
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      esbuild,
    },
    renderer: {
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [react(), tailwindcss()],
      esbuild,
    },
  };
});
