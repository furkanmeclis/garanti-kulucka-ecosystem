import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { canAccessPath, homePathFor } from "@/app/navigation";
import { AppShell } from "@/layout/app-shell";
import { OfflineScreen, SplashScreen } from "@/layout/status-screens";
import { LoginPage, redirectTarget } from "@/pages/login-page";
import { AccountsPage } from "@/pages/accounts-page";
import { CancellationsPage } from "@/pages/cancellations-page";
import { CargoPipelinePage } from "@/pages/cargo-pipeline-page";
import { CommentsPage } from "@/pages/comments-page";
import { CustomerDetailPage } from "@/pages/customer-detail-page";
import { CustomersPage } from "@/pages/customers-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { BalancesPage } from "@/pages/balances-page";
import { InstagramAnalyticsPage, InstagramPublishPage } from "@/pages/instagram-pages";
import { InventoryPage } from "@/pages/inventory-page";
import { InvoicesPage } from "@/pages/invoices-page";
import { MessagesPage } from "@/pages/messages-page";
import { OrdersPage } from "@/pages/orders-page";
import { ReportsPage } from "@/pages/reports-page";
import { SettingsPage } from "@/pages/settings-page";
import { SmsPage } from "@/pages/sms-page";
import { ShipmentsPage } from "@/pages/shipments-page";
import { ActivityLogsPage, UsersPage } from "@/pages/users-page";
import { VapiPage } from "@/pages/vapi-page";
import { DataDeletionPage, LegalPage } from "@/pages/public-pages";
import { DataDeletionRequestsPage } from "@/pages/data-deletion-requests-page";
import { CallsPage, PhonebookPage, VoiceMessagesPage } from "@/pages/voice-pages";
import { AiDebugPage, AiTrainingPage, InstagramDebugPage, WhatsappDebugPage } from "@/pages/debug-pages";
import { CronDebugPage, SuratDebugPage } from "@/pages/provider-debug-pages";

/** Legacy ProtectedRoute: anonymous → /giris (and back after login); pages outside the role → role home. */
function Protected({ children }: { children: ReactNode }) {
  const { status, user, retry } = useAuth();
  const location = useLocation();
  if (status === "loading") return <SplashScreen />;
  if (status === "offline") return <OfflineScreen onRetry={retry} />;
  if (status === "anonymous" || !user) {
    const from = location.pathname === "/" ? undefined : `${location.pathname}${location.search}`;
    return <Navigate to="/giris" replace state={from ? { from } : null} />;
  }
  if (!canAccessPath(user.role, location.pathname)) return <Navigate to={homePathFor(user.role)} replace />;
  return <AppShell>{children}</AppShell>;
}

function LoginRoute() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <SplashScreen />;
  if (status === "authenticated" && user) return <Navigate to={redirectTarget(location.state) ?? homePathFor(user.role)} replace />;
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/giris" element={<LoginRoute />} />
      <Route path="/veri-silme" element={<DataDeletionPage />} />
      <Route path="/gizlilik-politikasi" element={<LegalPage document="privacy" />} />
      <Route path="/kullanim-kosullari" element={<LegalPage document="terms" />} />
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/siparisler" element={<Protected><OrdersPage /></Protected>} />
      <Route path="/mesajlar" element={<Protected><MessagesPage /></Protected>} />
      <Route path="/musteriler" element={<Protected><CustomersPage /></Protected>} />
      <Route path="/musteriler/:id" element={<Protected><CustomerDetailPage /></Protected>} />
      <Route path="/kargolar" element={<Protected><ShipmentsPage /></Protected>} />
      <Route path="/kargolar/pipeline" element={<Protected><CargoPipelinePage /></Protected>} />
      <Route path="/kargo/pipeline" element={<Navigate to="/kargolar/pipeline" replace />} />
      <Route path="/kargolar/surat-debug" element={<Protected><SuratDebugPage /></Protected>} />
      <Route path="/kargolar/cron-debug" element={<Protected><CronDebugPage /></Protected>} />
      <Route path="/kargo/surat-debug" element={<Navigate to="/kargolar/surat-debug" replace />} />
      <Route path="/kargo/cron-debug" element={<Navigate to="/kargolar/cron-debug" replace />} />
      <Route path="/ayarlar" element={<Protected><SettingsPage /></Protected>} />
      <Route path="/ayarlar/whatsapp-debug" element={<Protected><WhatsappDebugPage /></Protected>} />
      <Route path="/ayarlar/instagram-debug" element={<Protected><InstagramDebugPage /></Protected>} />
      <Route path="/ayarlar/ai-debug" element={<Protected><AiDebugPage /></Protected>} />
      <Route path="/ayarlar/ai-egitim" element={<Protected><AiTrainingPage /></Protected>} />
      <Route path="/iptaller" element={<Protected><CancellationsPage /></Protected>} />
      <Route path="/stok" element={<Protected><InventoryPage /></Protected>} />
      <Route path="/bakiye" element={<Protected><BalancesPage /></Protected>} />
      <Route path="/yorumlar" element={<Protected><CommentsPage /></Protected>} />
      <Route path="/sms" element={<Protected><SmsPage /></Protected>} />
      <Route path="/instagram/analitik" element={<Protected><InstagramAnalyticsPage /></Protected>} />
      <Route path="/instagram/yayinla" element={<Protected><InstagramPublishPage /></Protected>} />
      <Route path="/raporlar" element={<Protected><ReportsPage /></Protected>} />
      <Route path="/faturalar" element={<Protected><InvoicesPage /></Protected>} />
      <Route path="/cari-hesaplar" element={<Protected><AccountsPage /></Protected>} />
      <Route path="/sesli-asistan" element={<Protected><CallsPage /></Protected>} />
      <Route path="/sesli-asistan/sesli-mesajlar" element={<Protected><VoiceMessagesPage /></Protected>} />
      <Route path="/sesli-asistan/vapi" element={<Protected><VapiPage /></Protected>} />
      <Route path="/sesli-asistan/rehber" element={<Protected><PhonebookPage /></Protected>} />
      <Route path="/kullanicilar" element={<Protected><UsersPage /></Protected>} />
      <Route path="/islem-loglari" element={<Protected><ActivityLogsPage /></Protected>} />
      <Route path="/veri-silme-talepleri" element={<Protected><DataDeletionRequestsPage /></Protected>} />
      {/* Legacy and web use /kargo; the beta list lives at /kargolar. */}
      <Route path="/kargo" element={<Navigate to="/kargolar" replace />} />
      <Route path="*" element={<Protected><Navigate to="/" replace /></Protected>} />
    </Routes>
  );
}
