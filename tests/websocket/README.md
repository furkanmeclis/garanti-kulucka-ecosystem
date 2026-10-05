# Websocket Tests

Socket.IO authentication, room membership, reconnect, fanout, stale-session, and schema tests.

## P6 Redis Fanout Gap

The current websocket harness is Vitest-only and does not bind HTTP ports, launch two API processes, or attach a live Redis streams adapter. It covers Redis fanout only at the configuration boundary: `apps/api/src/realtime.ts` installs the Redis adapter when `redisUrl` is configured, and unit tests cover validated publisher fanout plus room semantics in memory.

A full P6 Redis fanout proof still needs an environment that can start Redis and two API instances, connect one Socket.IO client to each instance, subscribe both to the same conversation room, publish through one API instance, and assert the client on the other instance receives the envelope.
