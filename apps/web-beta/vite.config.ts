import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Backend paths that must never be served from the service worker (API responses are not cached). */
export const backendPathDenylist = [/^\/backend\//, /^\/api\//, /^\/auth\//, /^\/admin\//, /^\/healthz/];

/** Fixed backend origin for the Playwright beta build (`--mode e2e`); routes are mocked in the browser. */
export const e2eBackendBaseUrl = "http://127.0.0.1:65531";

export default defineConfig(({ mode }) => ({
  define: mode === "e2e" ? { "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(e2eBackendBaseUrl) } : {},
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5174,
    proxy: {
      // Local dev: `npm run dev -w @garanti-kulucka/web-beta` talks to the API on :3000 through /backend.
      "/backend": { target: "http://127.0.0.1:3000", changeOrigin: true, rewrite: (path) => path.replace(/^\/backend/, "") },
    },
  },
  preview: { port: 4174 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Garanti Kuluçka Beta Panel",
        short_name: "GK Beta",
        description: "Garanti Kuluçka operasyon paneli (beta)",
        lang: "tr",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0b1220",
        theme_color: "#15803d",
        categories: ["business", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Static app shell only: no runtimeCaching, so API requests always go to the network.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: backendPathDenylist,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/node_modules[\\/](@radix-ui|lucide-react)[\\/]/.test(id)) return "ui";
          return undefined;
        },
      },
    },
  },
}));
