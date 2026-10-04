# Master Roadmap

This roadmap is the execution source of truth for the Garanti Kulucka ecosystem rebuild.

For a zero-context continuation in a new chat, start with [CONTINUATION_HANDOFF.md](./CONTINUATION_HANDOFF.md). It records the released baseline, remaining dependency order, activation gates, and verification workflow.

## Current Status

- Overall delivery is approximately 86% complete. This percentage includes implemented foundations, tested compatibility boundaries, the released schema identity checkpoint, the P1 safe `BIGINT` runtime policy, the P1 source manifest/completeness resume guard, P2 dry-run transforms for customer, conversation, message, product, order, order item, and shipment rows, P3 transaction, lock, row-content fingerprint, retry, and redaction safety guards, P4 real PostgreSQL dry-run source/target evidence, a catalog-level customer apply blocker for address/external identity fan-out readiness, real PostgreSQL recovery E2E evidence, a real PostgreSQL backup/restore rehearsal, and the released P5 backend-driven frontend shell with browser E2E coverage for the critical customer workflows plus inbox, comments, cancellations, inventory, balances, VAPI, order, shipment, shipment pipeline, Sürat debug, SMS, and reports detail surfaces. Production data migration activation, full legacy page parity, live provider adapters, production object storage operations, and full observability/runbook coverage remain incomplete.

- Phase 0 planning, contract inventory documents, backend OpenAPI route contract, and classified legacy endpoint surface guards are in place.
- Phase 1 foundation is implemented with API, worker, migrator, web runtime, Dockerfiles, compose config validation, CI/tag automation, local development gate documentation, and repository verification that rejects unfinished gate language in docs.
- Phase 2 canonical PostgreSQL schema is implemented with role/permission/provider seed data, migrations `002` and `003`, account-scoped customer external identities, account-aware conversation uniqueness, immutable migration run manifests, and run-scoped `legacy_id_map.mapping_role` provenance.
- Phase 2 runtime database access now installs a controlled PostgreSQL `int8` parser for API, worker, and migrator paths; safe integer range overflow fails fast instead of silently rounding.
- Phase 3 backend-owned auth and admin-managed persistence foundations are implemented: sessions, permissions, encrypted settings/tokens, restart-hydratable integration snapshots, admin integration APIs, admin audit trails, webphone config, file metadata, presigned S3-compatible media upload/download instructions, and audit boundaries. Auth lifecycle tests cover refresh rotation, logout revocation, disabled users, role denial, and backend-owned user presence updates.
- Phase 4 has backend/frontend typed client boundaries for auth, domain data, files, realtime, webphone, settings, integrations, integration account snapshots, admin audit trails, provider live-gate catalog views, provider attempt views, and normalized provider request preview view models. Direct Supabase usage is blocked by repository guards, web clients reject Supabase/provider origins as backend base URLs, and Playwright now exercises backend HTTP flows for inbox, messages, orders, shipments, admin settings, webphone config, Socket.IO message refresh parity, provider live-gate catalog visibility, provider attempt preview observability, and admin audit trail visibility.
- P5 frontend migration has a released backend-driven `apps/web` application shell: Vite/React entrypoint, routed legacy navigation surfaces, auth and public routes, backend auth session restore/logout, backend-owned presence toggle, domain API-backed inbox/message/customer/order/product/shipment actions, selectable conversation detail with backend message reload, Socket.IO `message.created` join/leave/live-refresh parity for selected and unselected conversations, admin provider live-gate catalog visibility for PTT, Surat, KolayBi, Meta, WhatsApp, Instagram, Messenger, NetGSM, Vapi, and SIP with `fixture_only` and `live_call_permitted: false` shown in the UI, admin provider attempt dry-run preview/redaction observability, settings and integration audit trail visibility with frontend redaction, admin-managed retry/timeout/rate-limit/queue/storage operation policy settings, admin-visible orphan file candidate reporting without deletion, customer directory/list/card summary backed by canonical customers with `kargo_operatoru` access denied, comments moderation detail backed by backend conversation/message summaries, legacy comment AI/platform summary backed by backend conversation summaries, cancellation review detail backed by backend order summaries, inventory product/stock category and critical stock summaries backed by backend products, inventory signal detail backed by backend order/shipment summaries, balances detail backed by backend order/settings summaries, legacy balance payment request summary backed by backend order summaries, VAPI AI detail backed by backend webphone/settings summaries, order and shipment detail panels backed by selected API summaries, selected-shipment status updates, legacy order total/active/confirmation/revenue summary sections backed by backend order summaries, legacy shipment carrier/status section summaries plus PTT/Sürat/not-delivered/tracking-missing filter summary backed by backend shipment summaries, legacy shipment pipeline route summary backed by backend shipment summaries, legacy Sürat debug route summary backed by provider attempt/catalog APIs with redacted dry-run previews, reports KPI/detail surface and legacy ratio summary backed by domain summaries, manual SMS template preview, character counter, and send-history summary backed by selected shipment/order summaries, Instagram publish preview and analytics summary backed by admin integration account snapshots, admin setting update, NetGSM SMS confirmation settings write flow, SIP/santral config settings write flow, admin integration-account list/upsert/detail/settings/token route flows, presigned file upload/download plus backend file metadata verification, webphone config, role-filtered navigation, desktop/mobile visual frame checks across all admin route surfaces, and `kargo_operatoru` desktop/mobile frame checks for the allowed inbox, orders, shipments, shipment pipeline, and SMS surfaces are covered by browser E2E. This is not yet full visual parity for every legacy page.
- Phase 5 provider contracts are fixture-only and worker-routed. Worker provider attempt persistence is wired to PostgreSQL when `DATABASE_URL` is configured, API webhook ingestion publishes accepted callbacks to BullMQ when `REDIS_URL` is configured, generated transport payloads are checked against frozen provider fixtures, provider retry/dead-letter decisions carry structured metadata, handler failures persist provider failure attempts, provider/channel boundaries are enforced, API catalog parity with worker adapters is contract-tested, provider fixture coverage is explicitly tracked at 15/15 covered, every covered fixture is replayed through the in-process worker handler without live provider calls, the `shipment-tracking` worker queue processes provider-qualified tracking jobs in fixture-only mode, the `migration-reports` worker queue accepts secret-free migrator reports and summarizes them outside the API process, the `ai-replies` worker queue produces fixture-only response drafts without live model calls, worker attempt metadata records fixture-only transport policy, provider live-gate catalog rows expose per-provider feature flag keys plus `live_call_permitted: false` through a read-only admin API and frontend panel, and provider dry-run request previews expose redacted method/path/header/body metadata through admin attempt serialization, route responses, and frontend admin view models. Provider attempts are exposed through secret-redacted admin APIs. Live provider calls remain blocked by a tested worker guard until legacy payload fixtures are fully replayed against implementation adapters.
- Phase 6 realtime and webphone boundaries are implemented with Socket.IO event contracts, Redis fanout support, and SIP/WebRTC kept outside API media routing.
- Phase 7 migrator foundation is implemented with manual commands, PostgreSQL legacy source reader, canonical target writer, source/target ports, batch planning, batch apply ports, batch offset/cursor separation, persisted batch execution state, completed batch resume skips, immutable source manifests, normalized database identity, schema/column snapshots, row counts, mapping catalog version, batch size, plan fingerprints, source row-content fingerprints, manifest hashes, run-scoped legacy ID maps, transaction-bound batch writes, run-scoped apply locking, mismatched-resume rejection, manifest-driven completeness checks, partial-apply rejection, orphan message verification, synthetic verification reports, canonical table verification reports, target database snapshot verification, migration gate snapshot coverage, order item legacy target verification, manual-only compose profile guards, optional secret-free command report files, real PostgreSQL recovery E2E, and real PostgreSQL backup/restore rehearsal. The P2 catalogs bind catalog, routing, version, and defensively owned snapshot selection for customers, conversations, messages, products, orders, order items, and shipments. Dry-run transforms `public.musteriler`, `public.konusmalar`, `public.mesajlar`, `public.urunler`, `public.siparisler`, `public.siparis_kalemleri`, and `public.kargo_gonderimleri` rows without target writes. Legacy `panel` maps to `manual`, legacy `calisan` maps to `user`, product categories normalize to canonical product types, order item product matching uses `urun_kodu` or `kolaybi_product_id` rather than `stok_id`, and shipment provider/status values normalize through explicit maps. Real PostgreSQL P4 evidence now runs the source runtime against Docker PostgreSQL legacy tables, prepares a clean canonical target through migrations `001` through `005`, proves dry-run leaves target migration/canonical tables untouched, proves transaction rollback and retry/resume after a simulated network drop, proves `pg_dump`/`pg_restore` restores canonical migration state and row fingerprints, and proves apply remains disabled even with source and target URLs. Address and external identity targets remain descriptive and are explicit customer apply prerequisites; if either target is descriptive or undeclared, customer apply fails before source/target access. Source reads pin `timezone = 'UTC'` and `datestyle = 'ISO, MDY'`. Production apply activation remains closed.
- Phase 8 release automation tags every passing `main` commit, publishes downloadable API, worker, migrator, and web container image artifacts, generates release notes from tag diffs, and documents tag-based rollback.
- Current released CI/tag state: `v0.1.240` at commit `2d4e7085163009410716dee4668aa0f75f104f27` (`feat(web): add surat debug route`). GitHub Actions Build and Tag run `37171894977` passed and produced unexpired `411123499` byte artifact `container-images-v0.1.240` with artifact id `11291412445`.
- Schema identity checkpoint is released: migration `002`, account-scoped customer external identities, account-aware conversation uniqueness, `legacy_id_map.mapping_role`, migrator entity/target/snapshot/verification updates, and `node-pg-migrate` `9.0.0` alignment passed database `6/6`, migrator `53/53`, migration `3/3`, clean PostgreSQL 18 `001 -> 002` up, `002` down/up, full `npm run check`, GitHub Actions run `36487291914`, tag `v0.1.116`, and artifact `container-images-v0.1.116`.
- P1 safe integer runtime policy is released: database unit `9/9`, migrator unit `54/54`, full `npm run check`, GitHub Actions run `36489230391`, tag `v0.1.118`, and artifact `container-images-v0.1.118`. Commit `3058d49` failed CI before tagging because migrator tests resolved the database package runtime export before build; follow-up commit `10e73f6` fixed the runtime import path and is the released checkpoint.
- P1 source manifest/completeness and resume guard is released at commit `1bab0fa1634745143eb6f7291ac77dc731fdf106`: migrator unit `82/82`, database unit `10/10`, migration boundary `3/3`, full `npm run check`, PostgreSQL 18 `001 -> 002 -> 003` plus `003` down/up and constraint guards, GitHub Actions run `36497700367`, tag `v0.1.120`, and `384237406` byte artifact `container-images-v0.1.120` containing API, worker, migrator, and web `.tar.gz` archives.
- P2 customer schema introspection is released at commit `656c5f96e5c22cb47c63a1c841324552a5775065`: mapping catalog `p2-customer-catalog-v1`, explicit fail-closed 15-column `public.musteriler` contract, migrator unit `142/142`, migration boundary `3/3`, full `npm run check`, GitHub Actions Build and Tag run `36503036840`, tag `v0.1.122`, and unexpired `384197701` byte artifact `container-images-v0.1.122` containing API, worker, migrator, and web `.tar.gz` archives. This checkpoint does not complete customer mapping or P2.
- P2 customer row transform library is released at commit `15627ade9f77cafe240e86b110bf21881aaa1a28`: local full `npm run check`, GitHub Actions Build and Tag run `36635362042`, tag `v0.1.124`, and unexpired `384247484` byte artifact `container-images-v0.1.124`. Migration `004` seeds the canonical WooCommerce provider.
- P2 account resolution and customer dry-run validation are released at commit `4ccc5ec2362e6189eb347cf716c22581a7dd0c7e`: local full `npm run check`, GitHub Actions Build and Tag run `36725232959`, tag `v0.1.126`, and unexpired `384223823` byte artifact `container-images-v0.1.126`. This checkpoint does not complete conversation or message mapping, and it does not open apply.
- P2 conversation and message schema contracts are released at commit `864840ccdbbe507bbe276264f2a7ec676ee5ba4f`: catalog `p2-conversation-catalog-v1`, GitHub Actions Build and Tag run `36728007710`, tag `v0.1.128`, and unexpired `384245659` byte artifact `container-images-v0.1.128`.
- P2 conversation and message row transforms are released at commit `1e91fefde6b17d1e4f2088b858e9a525351551b8`: local full `npm run check`, GitHub Actions Build and Tag run `36734240191`, tag `v0.1.130`, and unexpired `384167575` byte artifact `container-images-v0.1.130`. Dry-run transforms customer, conversation, and message rows and does not write to the target. Legacy `panel` maps to `manual` and legacy `calisan` maps to `user`. Non-panel conversations require `MIGRATION_CONVERSATION_ACCOUNTS_FILE`. Optional user resolution uses `MIGRATION_USER_PUBLIC_IDS_FILE`. Cross-row external id uniqueness is not checked yet. This checkpoint does not open apply.
- P2 order schema contract is released at commit `a43ce2409912811d690955bc60b45029be914f00`: catalog `p2-order-catalog-v1`, 47-column fail-closed `public.siparisler` contract, local full `npm run check`, GitHub Actions Build and Tag run `36774538298`, tag `v0.1.132`, and unexpired `384267991` byte artifact `container-images-v0.1.132`. Order rows are counted and schema-checked, not transformed. This checkpoint does not open apply.
- P2 order item schema contract is released at commit `339df477cc2e531d81ac3f4d73b27ee8f904db81`: catalog `p2-order-item-catalog-v1`, 12-column fail-closed `public.siparis_kalemleri` contract, local full `npm run check`, GitHub Actions Build and Tag run `36777973594`, tag `v0.1.134`, and unexpired `384249906` byte artifact `container-images-v0.1.134`. Order item rows are counted and schema-checked, not transformed. This checkpoint does not open apply.
- P2 shipment schema contract is released at commit `234e61c1b4b80de7904a9308e39cc5235ea1c784`: catalog `p2-shipment-catalog-v1`, 34-column fail-closed `public.kargo_gonderimleri` contract, local full `npm run check`, GitHub Actions Build and Tag run `36779746648`, tag `v0.1.136`, and unexpired `384279600` byte artifact `container-images-v0.1.136`. Shipment rows are counted and schema-checked, not transformed. This checkpoint does not open apply.
- P2 product schema contract is released at commit `2dccd55c36b9a1275263a366505b332a8f980d03`: catalog `p2-product-catalog-v1`, 13-column fail-closed `public.urunler` contract with an integer serial id, local full `npm run check`, GitHub Actions Build and Tag run `36787090887`, tag `v0.1.138`, and unexpired `384270251` byte artifact `container-images-v0.1.138`. Product rows are counted and schema-checked, not transformed. `siparis_kalemleri.stok_id` remains a uuid, so product matching cannot use that column as `urunler.id`. This checkpoint does not open apply.
- P2 product row transform is released at commit `2ef7541e463d2478f26465114d52947c0928d76f`: local full `npm run check`, GitHub Actions Build and Tag run `36788445794`, tag `v0.1.140`, and unexpired `384258240` byte artifact `container-images-v0.1.140`. Dry-run transforms product rows. `kulucka` maps to `incubator`, `yedek_parca` to `spare_part`, and `diger` to `other`. `unit`, `reorderLevel`, and `description` stay on the draft because the canonical product table has no columns for them. This checkpoint does not open apply.
- P2 order row transform is released at commit `07a8f37bd1f1e106919915228732a04944204ece`: local full `npm run check`, GitHub Actions Build and Tag run `36789719714`, tag `v0.1.142`, and unexpired `384260335` byte artifact `container-images-v0.1.142`. Unknown order status fails closed. An unresolved conversation keeps the row and records reconciliation. Catalog columns that are not first-class draft fields stay in `sourceRemainder`. Dry-run does not call this transform yet. This checkpoint does not open apply.
- P2 order dry-run validation is released at commit `dadd20a2f421cae3b8f41c81b276cd53fc1a2ab2`: local full `npm run check`, GitHub Actions Build and Tag run `36919695684`, tag `v0.1.144`, and unexpired `384237994` byte artifact `container-images-v0.1.144`. Dry-run transforms order rows using customer public ids from the same run. This checkpoint does not open apply.
- P2 order item and shipment dry-run transforms plus P3 migrator safety guards are released at commit `a630733eb0c0369595ca43a8100eb75d99af1d19`: ten local commits were batched after the required local-version window, GitHub Actions Build and Tag run `37120600335` passed, tag `v0.1.146` was created, and artifact `container-images-v0.1.146` is unexpired at `384286008` bytes. Order item dry-run validates `public.siparis_kalemleri`, links orders from same-run order drafts, matches products by `urun_kodu` or `kolaybi_product_id`, ignores `stok_id` as a product identifier, and fails closed on unresolved orders, bad checksums, short batches, and ambiguous product lookups. Shipment dry-run validates `public.kargo_gonderimleri`, maps customers when resolved, normalizes provider and status values, and reports unresolved customers plus provider counts. P3 batch writes, ID-map writes, and batch success checkpoints are transaction-bound; each apply run takes a run-scoped advisory lock; failed records do not clobber successful checkpoints; source row-content fingerprints are included in manifests and persisted through migration `005`; retry/resume idempotency and stronger secret redaction are covered by tests. This checkpoint does not open apply.
- Shipment dry-run failure guards are released at commit `5fa96eac8e3b4951142b064413a2aa42cd9c0c2a`: local migrator unit `456/456`, migration boundary `4/4`, structure verification, GitHub Actions Build and Tag run `37121305369`, tag `v0.1.148`, and unexpired `384279325` byte artifact `container-images-v0.1.148`. Orchestrator coverage now proves shipment catalog route mismatches stop before source access, row checksum mismatch fails closed, unsupported provider/status values fail closed, and short shipment batches fail closed. Shipment transform coverage also proves malformed checksum formats fail closed. This checkpoint does not open apply.
- P4 real PostgreSQL dry-run source/target evidence is released at commit `c5d2a25dd902938d411839c5a84902b43daec468`: local `npm run test:migrator`, full workspace `npm run typecheck`, `npm run compose:config`, GitHub Actions Build and Tag run `37122144165`, tag `v0.1.150`, and unexpired `384306690` byte artifact `container-images-v0.1.150`. The test creates real PostgreSQL legacy tables from the mapping catalog, seeds customers, conversations, messages, products, orders, order items, and shipments, prepares a clean canonical target database through migrations `001` through `005`, proves dry-run transforms all seven rows and emits row-content checksums, proves the canonical target remains unwritten, and proves apply remains disabled with both source and target URLs present.
- P4 customer apply-readiness decision is released at commit `b8b21a0002085a4edca6b7f5a44f251d772416a3`: local full `npm run check`, GitHub Actions Build and Tag run `37122867869`, tag `v0.1.152`, and unexpired `384283013` byte artifact `container-images-v0.1.152`. Customer apply now requires both `customer_external_identities` and `customer_addresses` to be executable catalog targets. Both targets remain descriptive because public-id to FK resolution, account snapshot enforcement, multi-record customer fan-out writes, and per-target `legacy_id_map.mapping_role` semantics are not production-ready. This checkpoint strengthens fail-closed production behavior and does not open apply.
- P4 real PostgreSQL recovery E2E is released at commit `5beecfffa95075dff05513247d571dd4a8e88c35`: local recovery E2E, local migrator tests, local full `npm run check`, GitHub Actions Build and Tag run `37123920729`, tag `v0.1.154`, and unexpired `384240603` byte artifact `container-images-v0.1.154`. The test simulates a network drop after canonical customer write inside the target transaction, proves rollback leaves `customers` and `legacy_id_map` empty while recording a failed batch, retries successfully, and proves a subsequent resume skips the completed source read without duplicates.
- P4 backup/restore rehearsal is released at commit `51f7fdc831f594c5177ed34c700496b40e92e529`: local backup/restore E2E, local migrator tests, local full `npm run check`, GitHub Actions Build and Tag run `37124329319`, tag `v0.1.155`, and unexpired `384305912` byte artifact `container-images-v0.1.155`. The rehearsal seeds canonical customers, migration runs, migration batches, and legacy ID maps; takes a real custom-format `pg_dump`; restores into a clean database with `pg_restore --no-owner`; and verifies restored row-count and fingerprint parity.
- P5 frontend shell migration is released through `v0.1.240`: `apps/web` now serves a real Vite/React application shell with backend auth, routed legacy navigation, auth/public route parity, backend-owned online/offline presence, backend domain actions for inbox/messages/customers/orders/products/shipments/admin settings, selectable conversation detail with backend message reload, Socket.IO `message.created` publish/broadcast plus browser join/leave/live-refresh parity, admin provider live-gate catalog visibility for PTT, Surat, KolayBi, Meta, WhatsApp, Instagram, Messenger, NetGSM, Vapi, and SIP with read-only `fixture_only`, feature flag, operation, channel, and `live_call_permitted: false` evidence, admin provider live gate write flow that stores `providers.ptt.live_mode=false` instead of enabling live calls, admin provider attempt dry-run request preview panel with local sensitive-key masking, admin settings/integration audit trail panels with local sensitive-key masking, admin-managed operations policy panel for retry, timeout, rate-limit, queue concurrency, storage bucket, lifecycle, and orphan cleanup values, admin-visible orphan file candidate report without deletion, customer directory/list/card summary backed by canonical customers, customer directory role-gating for `admin`/`calisan`, comments moderation detail and legacy AI/platform summary backed by backend conversation/message summaries, cancellation review detail backed by backend order summaries, inventory product/category/critical-stock detail backed by backend products, inventory signal detail backed by backend order/shipment summaries, balances detail and legacy payment request summary backed by backend order/settings summaries, VAPI AI detail backed by backend webphone/settings summaries, selected order and shipment detail panels, selected-shipment status update behavior, legacy order total/active/confirmation/revenue summary sections backed by backend order summaries, legacy shipment carrier/status/filter summary sections backed by backend shipment summaries, legacy shipment pipeline route summary backed by backend shipment summaries, legacy Sürat debug route summary backed by provider attempt/catalog APIs, reports KPI/detail surface and legacy delivery/confirmation/cargo movement ratio summary, manual SMS template preview, character counter, and send-history summary, Instagram publish preview and analytics summary, NetGSM SMS confirmation settings on the SMS surface, SIP/santral settings on the arama surface, admin integration-account list/upsert/detail/settings/token flows, presigned upload/download plus file metadata verification, webphone config, and role-filtered navigation. Browser E2E covers login, session restore/logout, inbox, conversation detail selection, Socket.IO selected conversation message refresh, Socket.IO broadcast refresh for an unselected conversation, conversation room join/leave commands, admin provider live-gate catalog route access with admin-only 200 and non-admin 403 backend E2E evidence, provider catalog UI evidence for `fixture_only`, `providers.ptt.live_mode`, `fixture_replay_contract_required`, `kapalı`, and all live adapter boundary providers, admin provider live gate request body `false`, admin provider attempt preview route access, non-admin no-fetch guard, local masking of raw provider secrets in preview headers/body, Sürat debug route evidence for `providers.surat.live_mode`, `fixture_replay_contract_required`, `POST /kargo-takip`, retry/duration/status, and redacted raw Sürat secrets, admin settings and integration audit route access plus local masking of raw audit secrets, operations policy read/write through `/admin/settings/operations.policy`, admin orphan file candidate route access with non-admin denial, customer directory list/card, `kargo_operatoru` denial for customer directory and customer API fetch, comments moderation detail, comments AI/platform summary, cancellation review detail, inventory legacy Kuluçka/Yedek Parçalar/Diğer Malzemeler product category summary, inventory product SKU/price/stock detail, inventory critical-stock tracking, inventory signal detail, balances detail and payment request summary, VAPI AI detail, message send, orders, order legacy summary filters, order detail selection plus created-order detail refresh, shipments, shipment legacy PTT/Sürat/yoldaki/teslim edilen section summary, shipment legacy filter summary, shipment detail order/barcode evidence, selected shipment update and SMS phone/preview continuity, shipment pipeline Mesaj/SMS/VAPI/Teslim summary, SMS send-history summary, reports metrics, reports legacy ratio summary, admin, NetGSM settings write through backend admin settings, SIP config settings write through backend admin settings, integration account list/upsert/detail/setting write/token masking, Instagram publish preview and analytics summary, file upload with `/api/files/:id` metadata verification, file download instruction plus presigned GET, webphone, public/auth routes, `kargo_operatoru` navigation filtering, backend `/auth/presence` toggling, desktop/mobile visual frame checks for all admin route surfaces including `/kargo/surat-debug`, and desktop/mobile visual frame checks for the `kargo_operatoru` inbox/orders/shipments/shipment pipeline/SMS route set without direct Supabase usage. The incremental P5 releases were `v0.1.207` manual SMS template preview, `v0.1.208` balance payment summary plus selected-shipment fix, `v0.1.209` comments AI/platform summary, `v0.1.210` shipment legacy filter summary, `v0.1.212` SMS send-history summary, `v0.1.213` Instagram publish preview, `v0.1.215` products inventory parity, `v0.1.217` customer directory parity, `v0.1.219` file metadata verification, `v0.1.222` realtime message parity, `v0.1.224` provider attempt preview observability, `v0.1.226` admin audit trail visibility, `v0.1.228` operational policy settings, `v0.1.230` presigned download flow, `v0.1.232` orphan file candidate visibility, `v0.1.234` provider live-gate catalog visibility, `v0.1.236` provider live gate disabled write flow, `v0.1.238` shipment pipeline route parity, and `v0.1.240` Sürat debug route parity. No `LegacySurfacePanel` helper remains in `apps/web`. This checkpoint does not complete full legacy page visual parity, real live HTTP provider adapters, or production object storage lifecycle/delete/restore operations.
- Next dependency gate: move from P4 evidence into true production apply prerequisites, starting with executable customer address and external identity fan-out writes, public-id-to-FK resolution, account snapshot enforcement, and per-target legacy ID map semantics. Core and production `migrate --apply` remain closed. Frontend migration and live provider adapters continue in their own gated tracks.

## Non-Negotiables

- Keep the customer-facing frontend experience stable.
- Remove direct Supabase usage from the frontend.
- Preserve external provider payloads, webhook responses, callback paths, and operational behavior.
- Use English `snake_case` for every new database identifier.
- Store admin-managed integration settings in PostgreSQL, not process memory.
- Keep database connection strings and core secrets outside the admin UI.
- Split runtime responsibilities into API, worker, migrator, web, PostgreSQL, Redis, and object storage containers.
- Treat tests as full-system checks: contract-first, e2e-style, repeatable without live provider credentials.

## Target Runtime

```text
apps/web       Browser UI, preserving existing workflows
apps/api       Hono + TypeScript HTTP API
apps/worker    BullMQ workers, webhooks, retries, scheduled jobs
apps/migrator  Manual one-shot data migration and verification container
postgres       Canonical operational database
redis          Queue backend, cache, rate limit, websocket fanout
garage         S3-compatible object storage
socket.io      Realtime application channel
jssip          Browser SIP/WebRTC webphone client boundary
```

## Phase 0 - Discovery And Contract Freeze

Goal: create the frozen compatibility surface before replacing internals.

Tasks:

- Extract every legacy `/api/*`, `/auth/*`, webhook, and cron endpoint.
- Extract frontend direct Supabase calls by page and service.
- Extract provider request/response examples for PTT, Surat, KolayBi, Meta, WhatsApp, Messenger, Instagram, NetGSM, Vapi, and SIP config.
- Create provider fixture files under `contracts/providers/*`.
- Create OpenAPI drafts for backend-facing frontend APIs.
- Create websocket event catalog.
- Create database naming map from legacy Turkish/mixed names to canonical English names.

Verification:

- `tests/contract` can replay fixture expectations without provider credentials.
- Grep report proves no unclassified legacy integration endpoint remains.
- Backend OpenAPI contract pins the current auth, domain, file, webphone, settings, and integration admin route surface consumed by the web app.
- Migration map covers every legacy table currently used by frontend or backend.
- Current contract tests cover the legacy API/webhook group classification manifest and reject unclassified groups.

Anti-pattern guards:

- Do not infer contracts from memory.
- Do not call live providers in CI.
- Do not preserve legacy table names in the canonical schema.

## Phase 1 - Foundation

Goal: create the deployable skeleton with real boundaries.

Tasks:

- Scaffold TypeScript config shared across workspaces.
- Implement Hono API bootstrap with request IDs, structured logging, health checks, and centralized error handling.
- Implement worker bootstrap with BullMQ, structured job logging, graceful shutdown, and retry policy.
- Implement migrator CLI with `migrate --dry-run`, `migrate --apply`, and `verify`.
- Add Dockerfiles for `api`, `worker`, `migrator`, and `web`.
- Add local `compose.yaml` for PostgreSQL, Redis, Garage, API, worker, migrator, and web.

Verification:

- `npm run check` passes locally and in GitHub Actions.
- Containers boot locally with health checks.
- API, worker, migrator, and web Docker images build successfully.
- API `/health/live` and `/health/ready` pass.
- Worker starts without processing jobs when no queues exist.
- Migrator dry-run exits successfully against empty/stub databases.
- Current foundation tests cover compose configuration validation, the local compose web runtime service, and web health endpoint port mapping.
- Repository structure verification rejects unfinished gate language in documentation and keeps local development docs aligned with the implemented check pipeline.

Anti-pattern guards:

- Do not place migration execution inside the API server.
- Do not make worker import Hono route handlers.
- Do not log secrets.

## Phase 2 - Canonical PostgreSQL Schema

Goal: replace Supabase tables with a clean PostgreSQL model.

Tasks:

- Build schema modules for users, roles, sessions, customers, conversations, messages, orders, shipments, balance, products, integrations, files, audit logs, worker jobs, and settings.
- Use English `snake_case`; reject Turkish or mixed-case identifiers.
- Add FK indexes explicitly.
- Use `timestamptz`, `numeric` for money, `text` for strings, and `jsonb` only for optional provider payloads.
- Add audit tables for admin-managed integration changes.
- Add durable integration account/token/settings tables.

Verification:

- Schema lint rejects quoted identifiers, Turkish table names, `timestamp without time zone`, `varchar`, `serial`, and missing FK indexes.
- Migration tests create a fresh database from zero.
- Seed data creates system roles, permissions, and providers without Supabase; first admin creation must use a dedicated bootstrap path so no password lands in migrations.

Anti-pattern guards:

- Do not encode business status as unstable Postgres enums.
- Do not use JSONB for core relations.
- Do not let provider config live only in `.env` or memory.

## Phase 3 - Auth And Admin Configuration

Goal: make backend-owned auth and persistent admin-managed settings production-safe.

Tasks:

- Implement email/password auth with Argon2id.
- Implement refresh-token rotation using httpOnly secure cookies.
- Implement access tokens for API and websocket authorization.
- Implement role and permission checks in API and worker paths.
- Implement admin settings APIs for integrations, AI prompts, webhook configuration, SIP/webphone config, feature flags, rate limits, and provider credentials.
- Store encrypted provider secrets in PostgreSQL using application-managed encryption keys from environment.

Verification:

- E2E auth test covers login, refresh, logout, revoked token, disabled user, and role-denied cases.
- Restart test proves Instagram/Messenger/WhatsApp accounts survive API and worker restarts.
- Audit log test proves admin setting changes are recorded.
- Current foundation tests cover token claims, admin bootstrap, secret encryption, auth serialization, auth lifecycle, settings masking, integration token masking, integration audit redaction, update old/new audit values, admin audit listing, presigned media upload/download instructions, and restart-hydration snapshots.

Anti-pattern guards:

- Do not expose provider secrets to the frontend.
- Do not keep connected accounts in module-level variables as source of truth.
- Do not let websocket connections bypass auth.

## Phase 4 - Frontend Data Access Migration

Goal: remove direct Supabase calls while preserving UI.

Tasks:

- Introduce typed API clients in `apps/web`.
- Replace direct Supabase auth calls with backend auth endpoints.
- Replace direct Supabase table queries with backend endpoints by domain.
- Replace Supabase realtime subscriptions with Socket.IO subscriptions.
- Keep page components visually and behaviorally stable.

Verification:

- Grep check finds no frontend `supabase.from`, `supabase.auth`, or Supabase channel usage outside temporary migration shims.
- Playwright e2e boots the API through a real Node HTTP server and validates `/health/live`, message inbox summaries, conversation messages, order summaries, shipment summaries, admin secret-masked settings, and webphone config over authenticated HTTP.
- API contract tests ensure frontend receives the same response shapes it expects.
- Current typed client tests cover auth, admin settings, integrations, admin audit trails, provider attempts, provider request preview view models, domain data, files, realtime, webphone route mapping, and backend-only base URL guards.

Anti-pattern guards:

- Do not redesign UI while replacing data access.
- Do not call PostgreSQL from frontend.
- Do not create feature-specific fetch logic inside page components.

## Phase 5 - Provider Integrations

Goal: port working legacy integrations behind adapter interfaces.

Tasks:

- Implement provider ports in domain/application code.
- Implement adapters for PTT, Surat, KolayBi, Meta Instagram/Messenger/WhatsApp, NetGSM, Vapi, and SIP config providers.
- Preserve request payloads and response normalization from legacy working code.
- Store every outbound attempt with request metadata, response metadata, duration, status, and retry decision.
- Route slow/retryable work to worker queues.

Verification:

- Provider contract tests compare generated payloads to frozen fixtures.
- Worker retry tests cover timeout, 429, 5xx, malformed response, and provider success after retry.
- No CI test requires live credentials.
- Current foundation tests cover provider envelopes, fixture-only handlers, provider live-call guards, provider dry-run request previews, provider catalog, provider/channel boundary validation, API/worker provider catalog parity, complete provider fixture coverage manifest validation, generated transport payloads, direct and aggregate message webhooks, covered-fixture replay through worker handlers, shipment tracking worker processor dispatch, migration report worker processor dispatch with secret leakage rejection, AI reply worker draft generation without live model calls, webhook ingestion, payload hashing, queue envelope creation, API webhook BullMQ publisher boundaries, provider attempt retry/dead-letter metadata decisions, handler failure attempt persistence, PostgreSQL attempt persistence, provider attempt admin serialization, provider request preview serialization, provider attempt route response previews, frontend provider request preview view models, fixture validation, and secret-free responses.

Anti-pattern guards:

- Do not "improve" provider payloads during migration.
- Do not mix provider adapters with HTTP controllers.
- Do not retry non-idempotent calls without idempotency keys.

## Phase 6 - Realtime And Webphone

Goal: replace Supabase realtime and preserve webphone behavior.

Tasks:

- Implement Socket.IO gateway with authenticated namespaces.
- Define event catalog for conversations, messages, orders, shipments, personnel presence, and settings reload.
- Use Redis for multi-instance websocket fanout.
- Keep SIP/WebRTC separate from application realtime.
- Keep JsSIP/SIP.js boundary in frontend; API only serves config and records call events.

Verification:

- Websocket tests cover auth reject, reconnect, room membership, event fanout, and stale session disconnect.
- Webphone tests cover config retrieval, permission gating, and call-log persistence without real SIP calls.
- Current foundation tests cover realtime event payload validation, room helpers, publisher fanout boundaries, frontend realtime client commands, and webphone config serialization.

Anti-pattern guards:

- Do not tunnel SIP media through the API.
- Do not use Socket.IO as a job queue.
- Do not store realtime state only in memory.

## Phase 7 - Migrator

Goal: migrate legacy data safely and repeatably.

Tasks:

- Implement source readers for legacy Supabase/Postgres.
- Implement canonical writers for new PostgreSQL.
- Implement mapping tables for legacy IDs to canonical IDs.
- Implement resumable batches with persisted execution state, completed batch skips, and idempotent upserts.
- Implement post-migration verification reports.
- Support dry-run, apply, and verify modes.

Verification:

- Migration tests run against synthetic legacy fixtures.
- Verification checks row counts, target database snapshots, referential integrity, orphan conversations/messages/orders/shipments, duplicate customers, message ordering, order totals, shipment references, legacy ID map coverage, account-aware mapping roles, and dangling legacy ID map targets including order items.
- Migrator can be re-run without duplicating data.
- Current foundation tests cover batch planning, dry-run reports, verification report totals, PostgreSQL legacy source reads, canonical target writes, target database snapshot reads, migration gate snapshot verification, orphan message verification, safe PostgreSQL `int8` parsing in migrator source runtime, batch apply ports, batch offset/cursor separation, persisted migration batch state, completed batch resume skips, source manifest identity/schema/count/fingerprint hashing, source row-content fingerprint persistence, immutable migration run persistence, mismatched-resume rejection, run-scoped role-aware legacy ID map upserts and coverage, transaction-bound batch apply state, run-scoped apply locking, retry/resume idempotency, dangling legacy ID map target verification including order items, manifest-driven canonical table verification, partial-apply rejection, manual-only migrator compose profile guards, secret-free CLI command reports, strengthened redaction coverage, order item dry-run failure guards, and shipment dry-run failure guards. This checkpoint does not open production apply.

Anti-pattern guards:

- Do not run migrator automatically on API startup.
- Do not mutate source data.
- Do not silently drop unmapped fields; report them.

## Phase 8 - Deployment And Release

Goal: make one-branch, no-PR delivery safe.

Tasks:

- Keep GitHub Actions on `main` only.
- Build and test every committed change.
- Auto-tag every passing commit with incrementing `vMAJOR.MINOR.PATCH`.
- Publish build artifacts and container images after successful checks.
- Add rollback docs for previous tag deploy.

Verification:

- A green commit creates exactly one tag.
- A failing commit creates no tag.
- Release notes can be generated from tag diff.
- Current release tests cover automatic tag creation, downloadable API, worker, migrator, and web container image artifacts, release notes generation from tag diffs, and tag-based rollback documentation.

Anti-pattern guards:

- Do not create branch-based workflow rules.
- Do not tag before tests pass.
- Do not deploy untagged images to production.
