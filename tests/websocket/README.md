# Websocket Tests

Socket.IO authentication, room membership, reconnect, fanout, stale-session, and schema tests.

## P6 Redis Fanout

`redis-fanout.test.ts` starts Redis in Docker (`redis:8-alpine`, override with `REDIS_FANOUT_IMAGE`, or point `REDIS_FANOUT_URL` at an existing Redis), then starts two independent API realtime instances: each has its own HTTP listener on a random port, its own Socket.IO server created by `attachRealtime`, and its own Redis connection with the Redis streams adapter. One Socket.IO client connects to each instance with a signed access token, both join the same conversation room, an envelope is published through instance A's `RealtimePublisher`, and the test asserts the client on instance B receives it. A second case proves user-room fanout across instances without leaking to another user. The container is removed in `afterAll`.

The suite is skipped only when neither Docker nor `REDIS_FANOUT_URL` is available.
