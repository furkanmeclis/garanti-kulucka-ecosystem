import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export const pageSize = 20;

/** List state lives in the URL (`?q=&page=&status=…`) so global search and reloads land on the same view. */
export function useListParams<F extends string>(filterKeys: readonly F[]) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const filtersKey = filterKeys.map((key) => `${key}=${params.get(key) ?? ""}`).join("&");
  const filters = useMemo(
    () => Object.fromEntries(filterKeys.map((key) => [key, params.get(key) ?? "all"])) as Record<F, string>,
    [filtersKey],
  );

  const update = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "" || value === "all" || (key === "page" && Number(value) <= 1)) next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage && !("page" in patch)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const hasFilters = Boolean(query) || filterKeys.some((key) => (params.get(key) ?? "all") !== "all");
  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { query, page, filters, update, hasFilters, clear, offset: (page - 1) * pageSize };
}

export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Client-side paging for endpoints without offset support (customers, conversations). */
export function paginate<T>(rows: T[], page: number) {
  const pages = pageCount(rows.length);
  const current = Math.min(page, pages);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), total: rows.length, page: current, pages };
}
