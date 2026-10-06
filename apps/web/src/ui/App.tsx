import { Suspense, useEffect, useRef } from "react";
import { Navigate, useNavigate, type Location } from "react-router-dom";
import { useDashboardController } from "./app/useDashboardController.js";
import type { AppNotification } from "./app/notifications.js";
import { flowFromPath, navigationItems } from "./app/shared.js";
import { AppLayout, homePathForRole } from "./layout/AppLayout.js";
import { useT } from "./i18n/index.js";
import { layoutMessages } from "./i18n/messages/layout.js";
import { LoginScreen, PublicPage, ResetPasswordScreen } from "./pages/AuthScreens.js";
import { OrderCreateModal } from "./pages/flows/OrderCreateModal.js";
import {
  AramaPage,
  AyarlarPage,
  BakiyePage,
  CancellationsFlow,
  CariHesaplarPage,
  CronDebugPage,
  CustomersFlow,
  FaturalarPage,
  FilesFlow,
  InboxFlow,
  InstagramAnalitikPage,
  InstagramYayinlaPage,
  IntegrationsFlow,
  KargoPrintView,
  OrdersFlow,
  RaporlarPage,
  ShipmentPipelineFlow,
  ShipmentsFlow,
  SmsPage,
  StokPage,
  SuratDebugPage,
  VapiAramalarPage,
  WebphoneFlow,
  YorumlarPage,
} from "./routes.js";

const loginPath = "/giris";

function isKnownAppPath(pathname: string) {
  return navigationItems.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}

/** Redirect target saved by the protected-route guard (legacy ProtectedRoute → /giris). */
function redirectTargetFrom(state: unknown) {
  const from = (state as { from?: Pick<Location, "pathname" | "search"> } | null)?.from;
  if (!from?.pathname || from.pathname === loginPath) return null;
  return `${from.pathname}${from.search ?? ""}`;
}

function PageFallback() {
  const t = useT(layoutMessages);
  return (
    <div className="page-fallback" data-testid="page-loading" role="status" aria-label={t("pageLoading")}>
      <span className="page-fallback-spinner" aria-hidden="true" />
    </div>
  );
}

export function App() {
  const ctx = useDashboardController();
  const navigate = useNavigate();
  const t = useT(layoutMessages);
  // Set while the user signs out so the guard sends them to /giris without remembering the last page.
  const signingOutRef = useRef(false);
  const {
    location,
    publicPage,
    token,
    authChecked,
    user,
    status,
    handleLogin,
    handleLogout,
    handleTogglePresence,
    visibleNavigation,
    activeFlow,
    canTogglePresence,
    presenceUpdating,
    orderFormOpen,
    http,
    domain,
    printShipmentId,
    setPrintShipmentId,
    setUser,
    notifications,
    handleSelectConversation,
    setSelectedShipmentId,
  } = ctx;

  useEffect(() => {
    if (token) signingOutRef.current = false;
  }, [token]);

  if (publicPage) {
    return <PublicPage page={publicPage} />;
  }

  if (location.pathname === "/sifre-sifirla") {
    return <ResetPasswordScreen />;
  }

  if (token && !authChecked) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand large">
            <span className="brand-mark">G</span>
            <span>Garanti Kuluçka</span>
          </div>
          <p>{t("sessionChecking")}</p>
        </div>
      </main>
    );
  }

  if (!token) {
    // Legacy ProtectedRoute: unauthenticated visitors land on /giris and return to the requested page after login.
    if (location.pathname !== loginPath) {
      const from =
        signingOutRef.current || location.pathname === "/"
          ? undefined
          : { pathname: location.pathname, search: location.search };
      return <Navigate replace to={loginPath} state={from ? { from } : null} />;
    }
    return <LoginScreen onLogin={handleLogin} status={status} />;
  }

  if (user) {
    const homePath = homePathForRole(user.role);
    if (location.pathname === loginPath) {
      return <Navigate replace to={redirectTargetFrom(location.state) ?? "/"} />;
    }
    if (location.pathname === "/") {
      return <Navigate replace to={homePath} />;
    }
    // Legacy: unknown paths → "/" and role-restricted pages → "/" (HomeRedirect).
    const requestedFlow = flowFromPath(location.pathname);
    const allowed = isKnownAppPath(location.pathname) && visibleNavigation.some((item) => item.key === requestedFlow);
    if (!allowed) {
      return <Navigate replace to={homePath} />;
    }
  }

  function handleLayoutLogout() {
    signingOutRef.current = true;
    void handleLogout();
  }

  function handleOpenNotification(notification: AppNotification) {
    if (notification.kind === "message") {
      navigate("/mesajlar");
      void handleSelectConversation(notification.conversationPublicId);
    } else {
      navigate("/kargo");
      setSelectedShipmentId(notification.shipmentPublicId);
    }
  }

  return (
    <AppLayout
      activeFlow={activeFlow}
      canTogglePresence={canTogglePresence}
      navigation={visibleNavigation}
      notifications={notifications}
      onOpenNotification={handleOpenNotification}
      onLogout={handleLayoutLogout}
      onTogglePresence={handleTogglePresence}
      presenceUpdating={presenceUpdating}
      status={status}
      user={user}
    >
      {activeFlow !== "orders" && orderFormOpen && <OrderCreateModal ctx={ctx} />}

      <Suspense fallback={<PageFallback />}>
        {activeFlow === "inbox" && <InboxFlow ctx={ctx} />}
        {activeFlow === "orders" && <OrdersFlow ctx={ctx} />}
        {activeFlow === "shipments" && <ShipmentsFlow ctx={ctx} />}
        {printShipmentId && (
          <Suspense fallback={null}>
            <KargoPrintView http={http} shipmentPublicId={printShipmentId} onClose={() => setPrintShipmentId(null)} />
          </Suspense>
        )}
        {activeFlow === "shipmentPipeline" && <ShipmentPipelineFlow ctx={ctx} />}
        {activeFlow === "suratDebug" && <SuratDebugPage http={http} />}
        {activeFlow === "cronDebug" && <CronDebugPage http={http} />}
        {activeFlow === "admin" && user && (
          <AyarlarPage
            http={http}
            user={user}
            onProfileUpdated={(firstName, lastName) =>
              setUser((current) => (current ? { ...current, first_name: firstName, last_name: lastName } : current))
            }
          />
        )}
        {activeFlow === "integrations" && <IntegrationsFlow ctx={ctx} />}
        {activeFlow === "comments" && <YorumlarPage http={http} />}
        {activeFlow === "customers" && <CustomersFlow ctx={ctx} />}
        {activeFlow === "cancellations" && <CancellationsFlow ctx={ctx} />}
        {activeFlow === "inventory" && <StokPage domain={domain} />}
        {activeFlow === "balances" && <BakiyePage http={http} role={user?.role} />}
        {activeFlow === "sms" && <SmsPage http={http} />}
        {activeFlow === "calls" && <AramaPage http={http} />}
        {activeFlow === "vapi" && <VapiAramalarPage http={http} />}
        {activeFlow === "reports" && <RaporlarPage http={http} />}
        {activeFlow === "invoices" && <FaturalarPage http={http} />}
        {activeFlow === "accounts" && <CariHesaplarPage http={http} />}
        {activeFlow === "instagramPublish" && <InstagramYayinlaPage http={http} />}
        {activeFlow === "instagramAnalytics" && <InstagramAnalitikPage http={http} />}
        {activeFlow === "files" && <FilesFlow ctx={ctx} />}
        {activeFlow === "webphone" && <WebphoneFlow ctx={ctx} />}
      </Suspense>
    </AppLayout>
  );
}
