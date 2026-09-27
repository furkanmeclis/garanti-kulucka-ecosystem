# Allowed APIs And Packages

## Hono API

Packages:

- `hono`
- `@hono/node-server`

Allowed patterns:

- `new Hono()`
- `app.get`, `app.post`, `app.put`, `app.delete`, `app.all`
- `app.route('/prefix', subApp)`
- `serve({ fetch: app.fetch, port })`
- `server.close(...)` for graceful shutdown
- `hono/cors` for CORS when needed

Avoid:

- Deprecated `@hono/node-ws`
- Business logic in route handlers
- Provider calls directly in HTTP delivery code

## Socket.IO

Packages:

- `socket.io`
- `@socket.io/redis-streams-adapter`
- `redis` or `ioredis`

Decision:

- Use Redis Streams adapter for connection state recovery and multi-instance fanout.
- Use sticky sessions at the load balancer.

Avoid:

- Old `socket.io-redis`
- Treating Socket.IO as SIP signaling or a job queue
- Assuming adapter messages are signed/encrypted

## BullMQ

Packages:

- `bullmq`
- `ioredis`

Allowed patterns:

- `new Queue(name, { connection })`
- `queue.add(jobName, data, options)`
- `new Worker(name, async (job) => result, { connection })`
- `new QueueEvents(queueName, { connection })`
- Worker Redis connection uses `maxRetriesPerRequest: null`
- `removeOnComplete` and `removeOnFail` must be bounded

Avoid:

- Unbounded completed/failed jobs
- CPU-bound work in the event loop
- Local worker events as the only cluster-wide observability source

## Garage S3

Client:

- AWS SDK v3 `@aws-sdk/client-s3` with endpoint override

Allowed S3 features:

- Core bucket/object APIs
- Presigned URLs
- Multipart uploads
- Signature V4

Avoid relying on unsupported or limited AWS S3 features:

- ACL APIs
- Bucket policies
- Versioning
- Object lock/legal hold/retention
- Bucket notifications
- Replication APIs
- Tagging APIs

## PostgreSQL Tooling

Decision:

- Kysely for application queries
- node-pg-migrate for production migrations

Avoid:

- ORM auto-sync
- Running migrations from API startup
- Migration files depending on current application types

## Webphone

Frontend boundary:

- JsSIP or SIP.js

Backend boundary:

- Provide authorized SIP config
- Store encrypted extension credentials
- Record call logs/events

Avoid:

- Routing RTP/audio through API
- Mixing application Socket.IO events with SIP signaling
- Production `ws://`; use WSS
