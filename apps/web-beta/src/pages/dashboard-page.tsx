import { lazy, Suspense } from "react";
import { PageHeader } from "@/layout/page-header";
import { useTranslation } from "react-i18next";

/** Pano (/). The analytics view (recharts) is code-split so the app shell stays light. */
const DashboardView = lazy(() => import("./dashboard/dashboard-view").then((module) => ({ default: module.DashboardView })));

function DashboardFallback() {
  const { t } = useTranslation();
  return (
    <section data-testid="page-dashboard" aria-busy="true">
      <PageHeader title={t("dashboard.title")} description={t("dashboard.welcomeAnonymous")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </section>
  );
}

export function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardView />
    </Suspense>
  );
}
