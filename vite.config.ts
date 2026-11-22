import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        // Editors write atomically through dot-directories; watching those
        // transient files crashes the dev server with EBUSY on Windows.
        "**/.*.tmpdir/**",
        "**/*.tmp",
      ],
    },
  },
  build: {
    target: "chrome110",
    sourcemap: false,
  },
});
