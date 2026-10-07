# Monitoring Stack (compose `monitoring` profile)

Prometheus, Alertmanager and Grafana for local and staging use, wired to the metric catalog in `OBSERVABILITY.md` and the alert table in `ALERTS_AND_INCIDENT_RUNBOOKS.md`. Production may run the same files on its own monitoring host; nothing here changes the live-write locks.

## Start

```bash
METRICS_ENABLED=true docker compose --profile monitoring up -d
```

| UI | Address | Notes |
| --- | --- | --- |
| Prometheus | http://127.0.0.1:9090 | targets, rules, ad-hoc PromQL |
| Alertmanager | http://127.0.0.1:9093 | routing by `severity` |
| Grafana | http://127.0.0.1:3002 | user `GRAFANA_ADMIN_USER` (default `admin`), password `GRAFANA_ADMIN_PASSWORD`; set your own value outside local machines |

All three bind to `127.0.0.1` only. Without `METRICS_ENABLED=true` the stack starts but API and worker answer `404` on `/metrics` and `MetricsScrapeMissing` fires.

## What Is Scraped

| Job | Target | Source |
| --- | --- | --- |
| `api` | `api:9464` | API internal metrics listener (`METRICS_PORT=9464`, never published) |
| `worker` | `worker:3001` | worker health listener (`METRICS_PORT` = `WORKER_HTTP_PORT` = 3001, never published) |

No bearer token is needed because both listeners are internal; the public API port keeps answering `404` without a token.

## Files

| Path | Content |
| --- | --- |
| `infra/monitoring/prometheus/prometheus.yml` | scrape jobs, Alertmanager target |
| `infra/monitoring/prometheus/rules/alerts.yml` | alert rules, one per row of the runbook table (`severity: page|ticket`) |
| `infra/monitoring/alertmanager/alertmanager.yml` | `page` / `ticket` routing and inhibitions; receivers ship empty |
| `infra/monitoring/grafana/provisioning/` | Prometheus + Alertmanager datasources, dashboard provider |
| `infra/monitoring/grafana/dashboards/` | `API`, `Kuyruklar`, `Sağlayıcılar`, `Göç ve Depolama` |

`tests/contract/monitoring-stack.test.ts` fails when a dashboard or rule queries a metric outside the catalog, when a catalog metric has no panel, or when a runbook alert has no rule. Validate syntax with `promtool check config|rules` and `amtool check-config` before changing thresholds.

## Alerts Not Covered Here

`ReadinessDegraded`, `DatabaseDown`, `RedisDown` and `DiskSpaceLow` need a blackbox exporter probing `/health/ready` and a node exporter on the hosts; add them where those exporters run. `garage_capacity_bytes` and `garage_backup_age_seconds` come from the external Garage/backup scrape described in `STORAGE_ALERTS_AND_INCIDENTS.md`; their panels stay empty until that scrape exists.

## Notifications

Alertmanager receivers have no integrations in git, so the local stack never notifies anyone. Per environment, add `webhook_configs` / `email_configs` / `slack_configs` to the `page` and `ticket` receivers, keeping credentials in `*_file` paths mounted from secrets.
