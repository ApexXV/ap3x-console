import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths so a build can be served from any folder (rackmain1's wall-ui, a Pi, a CDN).
  base: "./",
  build: { target: "es2022", outDir: "dist" },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"] },
});
