# System Architecture

## Dependency Direction

The architecture follows a ports-and-adapters structure.

```text
domain
  entities, value objects, business rules

application
  use cases, ports, transaction boundaries

adapters
  postgres, redis, garage, providers, auth crypto, websocket transport

delivery
  Hono HTTP routes, Socket.IO gateway, worker processors, migrator CLI
```

Dependencies point inward. Delivery code may call application use cases; use cases never import Hono, Socket.IO, BullMQ, PostgreSQL clients, or provider SDKs.

## Containers

### API

- Handles immediate HTTP requests.
- Owns auth, authorization, API response shaping, request validation, and request logging.
- Enqueues long-running work.
- Does not process background retries inline.

### Worker

- Processes BullMQ jobs.
- Handles provider retries, webhook fanout, scheduled synchronization, AI response generation, and notification work.
- Uses the same application use cases through worker delivery adapters.

### Migrator

- Manual container.
- Connects to legacy source and new target.
- Runs dry-run, apply, and verify commands.
- Never runs inside API or worker startup.

### Web

- Keeps existing user workflows.
- Talks only to API and Socket.IO.
- Does not import Supabase in the final state.

### PostgreSQL

- Canonical source of truth.
- Stores users, sessions, domain data, provider accounts, admin settings, files, audit logs, and id mappings.

### Redis

- BullMQ backend.
- Socket.IO fanout.
- Rate-limit counters.
- Short-lived caches only.

### Garage

- S3-compatible object storage.
- Stores uploaded media, PDFs, attachments, generated labels, call recordings if applicable, and exported reports.

## Durable Configuration Rule

Admin-managed runtime configuration must live in PostgreSQL.

Examples:

- Instagram connected accounts and tokens
- Messenger page configuration
- WhatsApp Cloud API phone IDs and tokens
- KolayBi, PTT, Surat, NetGSM, Vapi settings
- AI prompts and model settings
- SIP/webphone display and connection defaults
- Feature flags and rate limits

Environment variables are allowed only for:

- Database connection strings
- Redis connection strings
- Garage root/bootstrap credentials
- Encryption master key
- Cookie/JWT signing keys
- Deployment environment metadata

## Restart Behavior

API and worker startup must load active integration settings from PostgreSQL. Module-level memory may cache values, but the database remains the source of truth.

When admin settings change:

1. API validates and writes the change to PostgreSQL.
2. API writes an audit log entry.
3. API publishes a `settings.changed` event through Redis/Socket.IO or a worker queue.
4. API and worker refresh their local caches.

## Realtime Boundary

Socket.IO carries application events:

- `conversation.created`
- `conversation.assigned`
- `message.created`
- `message.read`
- `order.created`
- `order.updated`
- `shipment.updated`
- `presence.updated`
- `settings.changed`

SIP/WebRTC webphone traffic is separate. The backend provides config, authorization, and call-log APIs. It does not proxy browser audio.
