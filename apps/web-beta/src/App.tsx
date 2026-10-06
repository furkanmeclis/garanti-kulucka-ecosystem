import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { canAccessPath, homePathFor } from "@/app/navigation";
import { AppShell } from "@/layout/app-shell";
import { OfflineScreen, SplashScreen } from "@/layout/status-screens";
import { LoginPage, redirectTarget } from "@/pages/login-page";
import { CustomersPage } from "@/pages/customers-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { MessagesPage } from "@/pages/messages-page";
import { OrdersPage } from "@/pages/orders-page";
import { SettingsPage } from "@/pages/settings-page";
import { ShipmentsPage } from "@/pages/shipments-page";

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
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/siparisler" element={<Protected><OrdersPage /></Protected>} />
      <Route path="/mesajlar" element={<Protected><MessagesPage /></Protected>} />
      <Route path="/musteriler" element={<Protected><CustomersPage /></Protected>} />
      <Route path="/kargolar" element={<Protected><ShipmentsPage /></Protected>} />
      <Route path="/ayarlar" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Protected><Navigate to="/" replace /></Protected>} />
    </Routes>
  );
}
