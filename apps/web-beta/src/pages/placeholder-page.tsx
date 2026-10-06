import { useTranslation } from "react-i18next";
import type { NavKey } from "@/app/navigation";
import { PageHeader } from "@/layout/page-header";

export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  const { t } = useTranslation();
  return (
    <section data-testid={`page-${navKey}`}>
      <PageHeader title={t(`nav.${navKey}`)} />
    </section>
  );
}
