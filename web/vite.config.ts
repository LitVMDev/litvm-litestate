import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the built site works from any path, including
  // ipfs://<cid>/ or a plain local folder opened over file:// via a
  // static server. No absolute host is baked in.
  base: "./",
  build: {
    outDir: "dist",
    // Off deliberately. Source maps publish the full original source, and on
    // some toolchains embed absolute build paths. Nothing here needs debugging
    // in production, and a smaller published surface is worth more than the
    // convenience — particularly if the repository is kept private.
    sourcemap: false,
  },
});
