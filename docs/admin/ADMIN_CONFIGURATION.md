# Admin Configuration

## Principle

Everything operationally changeable must be editable from the admin UI unless it is a deployment-level secret or infrastructure connection string.

## Admin Editable

- Integration accounts
- Provider API URLs when safe
- Provider public IDs
- Provider tokens and credentials through encrypted storage
- Webhook verify tokens
- AI prompts and model settings
- Kargo pipeline settings
- NetGSM voice/SMS settings
- SIP/webphone settings
- Feature flags
- Rate limits
- Notification templates
- Quick replies
- Business status labels and allowed transitions where applicable

## Not Admin Editable

- PostgreSQL connection string
- Redis connection string
- Garage bootstrap/root credentials
- Encryption master key
- JWT/cookie signing keys
- Deployment hostnames that are controlled by infrastructure

## Persistence Model

```text
integration_providers
integration_accounts
integration_tokens
integration_settings
webhook_subscriptions
settings
audit_logs
```

Provider secrets are encrypted before storage. The encryption key is supplied by environment and never returned to the frontend.

## Restart Guarantee

No connected account may depend on runtime memory. On restart, API and worker reload active accounts and settings from PostgreSQL.

Required test:

1. Connect/update an Instagram account through admin API.
2. Restart API and worker.
3. Send a simulated webhook.
4. Verify the correct account/token/config is resolved from PostgreSQL.

## Implemented API Boundary

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /admin/settings?scope=global`
- `PUT /admin/settings/:key`

Secret settings are persisted but serialized with `value: null` in API responses. Changes write `audit_logs` rows with actor, request metadata, old value, and new value.
