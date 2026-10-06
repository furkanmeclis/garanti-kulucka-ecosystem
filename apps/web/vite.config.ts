import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Route pages are lazy chunks; keep the shared icon set in one chunk instead of dozens of sub-1 kB files.
        manualChunks(id: string) {
          return /node_modules[\\/]lucide-react[\\/]/.test(id) ? "icons" : undefined;
        },
      },
    },
  },
});
