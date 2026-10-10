import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/layout/page-header";

/** /raporlar (managers) — İş Analizi. The analytics view (recharts) is code-split so the app shell stays light. */
const ReportsView = lazy(() => import("./reports/reports-view").then((module) => ({ default: module.ReportsView })));

function ReportsFallback() {
  const { t } = useTranslation();
  return (
    <section data-testid="page-reports" aria-busy="true">
      <PageHeader title={t("reports.title")} description={t("reports.subtitleNew")} />
      <div className="mb-5 h-40 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </section>
  );
}

export function ReportsPage() {
  return (
    <Suspense fallback={<ReportsFallback />}>
      <ReportsView />
    </Suspense>
  );
}
