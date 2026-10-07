import { lazy, type ComponentType } from "react";

const chunkReloadKey = "garanti.web.chunk-reload";

/**
 * Legacy `lazyWithRetry` (frontend/src/App.jsx): when a deploy removes old chunks the import fails;
 * reload once (guarded for 10s so it never loops), otherwise surface the error.
 */
function lazyPage<T extends ComponentType<any>>(load: () => Promise<T>) {
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch (error) {
      let lastReload: string | null = null;
      try {
        lastReload = window.sessionStorage.getItem(chunkReloadKey);
      } catch {
        lastReload = null;
      }
      if (lastReload && Date.now() - Number(lastReload) < 10_000) {
        throw error;
      }
      try {
        window.sessionStorage.setItem(chunkReloadKey, String(Date.now()));
      } catch {
        throw error;
      }
      window.location.reload();
      return new Promise<{ default: T }>(() => undefined);
    }
  });
}

// Inline dashboard flows split out of App.tsx (they read state from the dashboard controller).
export const InboxFlow = lazyPage(() => import("./pages/flows/InboxFlow.js").then((m) => m.InboxFlow));
export const OrdersFlow = lazyPage(() => import("./pages/flows/OrdersFlow.js").then((m) => m.OrdersFlow));
export const ShipmentsFlow = lazyPage(() => import("./pages/flows/ShipmentsFlow.js").then((m) => m.ShipmentsFlow));
export const ShipmentPipelineFlow = lazyPage(() =>
  import("./pages/flows/ShipmentPipelineFlow.js").then((m) => m.ShipmentPipelineFlow),
);
export const IntegrationsFlow = lazyPage(() => import("./pages/flows/IntegrationsFlow.js").then((m) => m.IntegrationsFlow));
export const CustomersFlow = lazyPage(() => import("./pages/flows/CustomersFlow.js").then((m) => m.CustomersFlow));
export const CancellationsFlow = lazyPage(() => import("./pages/flows/CancellationsFlow.js").then((m) => m.CancellationsFlow));
export const FilesFlow = lazyPage(() => import("./pages/flows/FilesFlow.js").then((m) => m.FilesFlow));
export const WebphoneFlow = lazyPage(() => import("./pages/flows/WebphoneFlow.js").then((m) => m.WebphoneFlow));

// Self-contained page modules.
export const SuratDebugPage = lazyPage(() => import("./pages/SuratDebugPage.js").then((m) => m.SuratDebugPage));
export const CronDebugPage = lazyPage(() => import("./pages/CronDebugPage.js").then((m) => m.CronDebugPage));
export const AyarlarPage = lazyPage(() => import("./pages/AyarlarPage.js").then((m) => m.AyarlarPage));
export const YorumlarPage = lazyPage(() => import("./pages/YorumlarPage.js").then((m) => m.YorumlarPage));
export const StokPage = lazyPage(() => import("./pages/StokPage.js").then((m) => m.StokPage));
export const BakiyePage = lazyPage(() => import("./pages/BakiyePage.js").then((m) => m.BakiyePage));
export const SmsPage = lazyPage(() => import("./pages/SmsPage.js").then((m) => m.SmsPage));
export const AramaPage = lazyPage(() => import("./pages/AramaPage.js").then((m) => m.AramaPage));
export const VapiAramalarPage = lazyPage(() => import("./pages/VapiAramalarPage.js").then((m) => m.VapiAramalarPage));
export const RaporlarPage = lazyPage(() => import("./pages/RaporlarPage.js").then((m) => m.RaporlarPage));
export const InstagramYayinlaPage = lazyPage(() =>
  import("./pages/InstagramYayinlaPage.js").then((m) => m.InstagramYayinlaPage),
);
export const InstagramAnalitikPage = lazyPage(() =>
  import("./pages/InstagramAnalitikPage.js").then((m) => m.InstagramAnalitikPage),
);
export const FaturalarPage = lazyPage(() => import("./pages/FaturalarPage.js").then((m) => m.FaturalarPage));
export const CariHesaplarPage = lazyPage(() => import("./pages/CariHesaplarPage.js").then((m) => m.CariHesaplarPage));
export const SesliMesajlarPage = lazyPage(() => import("./pages/SesliMesajlarPage.js").then((m) => m.SesliMesajlarPage));
export const RehberPage = lazyPage(() => import("./pages/SesliMesajlarPage.js").then((m) => m.RehberPage));
export const WhatsAppDebugPage = lazyPage(() => import("./pages/DebugPages.js").then((m) => m.WhatsAppDebugPage));
export const InstagramDebugPage = lazyPage(() => import("./pages/DebugPages.js").then((m) => m.InstagramDebugPage));
export const AiDebugPage = lazyPage(() => import("./pages/DebugPages.js").then((m) => m.AiDebugPage));
export const AiTrainingPage = lazyPage(() => import("./pages/DebugPages.js").then((m) => m.AiTrainingPage));
export const KargoPrintView = lazyPage(() => import("./pages/KargoPrintView.js").then((m) => m.KargoPrintView));
