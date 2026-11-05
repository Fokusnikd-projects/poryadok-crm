import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { yandexPlugin } from "./server/yandex-api.mjs";

export default defineConfig({
  // GitHub Pages serves the project under /<repo>/ ; local runs stay at /.
  base: process.env.VITE_BASE || "/",
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [yandexPlugin(), react()],
});
