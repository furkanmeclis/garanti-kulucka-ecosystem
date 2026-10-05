# Load Scripts

Dependency-free load scripts (Node 22+ `fetch`, `node:crypto`; the fanout script uses the
`socket.io-client` package already installed by the web workspace). Nothing here runs in CI
against a network host; `tests/integration/load-tools.test.ts` only exercises the scripts against
an in-process `127.0.0.1` server.

## Güvenlik kuralları

- Yalnızca local stack veya size ait **staging** ortamı hedeflenir. Production hedeflenmez.
- `localhost`, `127.0.0.1`, `[::1]`, `api` dışındaki her host için `--confirm-target=<host>` zorunludur;
  host adı birebir tekrar edilmezse script çalışmaz.
- Ayrı bir load-test kullanıcısı ve kısa ömürlü access token kullanın. Token'ı shell history'e yazmamak
  için `read -s LOAD_ACCESS_TOKEN && export LOAD_ACCESS_TOKEN` tercih edin.
- Webhook testi staging'de gerçek `webhook_events` satırları ve worker job'ları üretir; test sonrası
  `loadtest-` önekli kayıtları temizleyin veya staging veritabanını snapshot'tan geri yükleyin.
- Rate limit (`WEBHOOK_RATE_LIMIT_PER_MINUTE`) staging'de 429 dönebilir; bu beklenen backpressure'dır,
  raporda `statuses` altında ayrıca görünür.

## Ortak parametreler

| Flag | Env | Varsayılan | Açıklama |
| --- | --- | --- | --- |
| `--target` | `LOAD_TARGET_URL` | zorunlu | API origin, ör. `https://api.staging.example.com` |
| `--confirm-target` | `LOAD_CONFIRM_TARGET` | — | Remote host adı (güvenlik kapısı) |
| `--duration` | `LOAD_DURATION_SECONDS` | 30 (fanout: 60) | Saniye cinsinden süre |
| `--concurrency` | `LOAD_CONCURRENCY` | 10 | Paralel kapalı döngü sayısı |
| `--max-p95` | `LOAD_MAX_P95_MS` | 500 / 300 / 1000 | Aşılırsa exit code 1 |

Hata oranı eşiği %1'dir. Çıktı JSON'dur; staging sonuçlarını release notlarına veya
`docs/operations` altındaki kapasite kayıtlarına ekleyin.

## API list endpointleri

```bash
export LOAD_TARGET_URL=https://api.staging.example.com
export LOAD_ACCESS_TOKEN=...   # load-test kullanıcısının access token'ı
node tools/load/api-list.mjs --confirm-target=api.staging.example.com --duration=60 --concurrency=25
# Belirli endpointler:
node tools/load/api-list.mjs --paths=/api/orders?limit=100,/api/conversations?limit=50 ...
```

Varsayılan endpointler: orders, customers, conversations, products, shipments list ve orders summary.

## Webhook ingress

```bash
export LOAD_WEBHOOK_SECRET=...  # staging'deki provider webhook secret'ı
node tools/load/webhook-ingress.mjs --confirm-target=api.staging.example.com \
  --provider=meta --duration=60 --concurrency=20 --replay-percent=10
```

Meta ailesi (`meta`, `instagram`, `messenger`, `whatsapp`) için `x-hub-signature-256` HMAC hesaplanır;
diğer providerlar için `x-webhook-token` gönderilir. `--replay-percent` oranındaki istekler daha önce
gönderilmiş payload'ı tekrarlar ve idempotency yolunu (duplicate kabul, yeni job yok) ölçer.

## Socket.IO fanout

```bash
node tools/load/socket-fanout.mjs --confirm-target=api.staging.example.com \
  --clients=300 --ramp=10000 --duration=120 --conversation=<conversation_public_id>
```

Script istemcileri `--ramp` süresine yayarak bağlar, `conversation.join` ile odaya katılır ve
gözlem süresi boyunca alınan event'leri sayar. `latency_ms` handshake süresidir;
`delivery_latency_ms` event `occurred_at` alanından istemciye ulaşma süresidir. Fanout üretmek için
aynı anda `webhook-ingress.mjs` çalıştırın. Çoklu API instance'ında Redis streams adapter'ın
dağıtımını görmek için load balancer arkasındaki URL hedeflenmelidir.

## Local stack

```bash
docker compose up -d postgres redis api worker
LOAD_TARGET_URL=http://localhost:3000 LOAD_ACCESS_TOKEN=... node tools/load/api-list.mjs --duration=10
```
