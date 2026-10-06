import { registerSW } from "virtual:pwa-register";

/** Registers the static-asset service worker (production builds only). */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  registerSW({ immediate: true });
}
