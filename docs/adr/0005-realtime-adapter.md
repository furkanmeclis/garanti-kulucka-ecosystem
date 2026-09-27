# ADR 0005: Realtime Adapter

## Status

Accepted

## Decision

Use Socket.IO for application realtime and target the Redis Streams adapter for multi-instance fanout and connection state recovery.

## Rationale

The product needs room-based application events, reconnect behavior, authenticated subscriptions, and horizontal scaling. Redis Streams is a better fit than plain Redis Pub/Sub where temporary Redis disconnect packet loss is unacceptable.

## Consequences

- Sticky sessions are required at the load balancer.
- Socket.IO event schemas live in `packages/shared`.
- SIP/WebRTC webphone signaling remains separate from application realtime.
- Redis is required runtime infrastructure.
