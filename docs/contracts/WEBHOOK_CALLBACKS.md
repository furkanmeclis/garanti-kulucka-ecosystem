# Provider Webhook Callback Contract

Provider webhook ingestion is intentionally stable and small. Legacy exact paths can be mapped onto
these callbacks later without changing the worker contract.

## Stable Paths

- `GET|POST /webhooks/meta`
- `GET|POST /webhooks/instagram`
- `GET|POST /webhooks/messenger`
- `GET|POST /webhooks/whatsapp`
- `GET|POST /webhooks/netgsm`
- `GET|POST /webhooks/vapi`
- `GET|POST /webhooks/ptt`
- `GET|POST /webhooks/surat`
- `GET|POST /webhooks/kolaybi`

## Accepted Response

Successful `POST` requests return `202` with this stable shape:

```json
{
  "status": "accepted",
  "provider": "whatsapp",
  "event_public_id": "wev_...",
  "payload_hash": "sha256_hex",
  "queued": true,
  "job_id": "job_..."
}
```

Verification tokens and signature values must never be returned in responses. Query verification
tokens are also excluded from the persisted webhook raw payload.

## Persistence And Queue Boundary

Each accepted callback creates one `webhook_events` row with:

- provider and account when resolvable
- `status = received`
- deterministic `payload_hash`
- sanitized `raw_payload`

The API then builds a shared `JobEnvelope` for the `provider-webhooks` queue. The route uses an API
queue publisher abstraction so tests and local development can use a fake/no-op publisher while the
production publisher can be wired to BullMQ without changing the HTTP contract.

## Verification Stub

`webhook_subscriptions.verify_token_hash` is honored when configured. Missing verification settings
do not block fixture/local callbacks because live provider credentials are not required in this
foundation phase.
