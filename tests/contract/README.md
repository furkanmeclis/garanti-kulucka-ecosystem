# Contract Tests

Provider, API, webhook, and realtime contract tests.

## Provider Fixture Replay Gate

Provider fixtures are frozen contract evidence. A replay gate should read only
`contracts/providers/coverage.json` entries with `status: "covered"` and replay
the referenced JSON fixture through the matching in-process adapter path. The
gate must not call live provider endpoints, require provider credentials, or
mutate fixture files.

When adding a new provider operation, add the fixture first, register it in the
coverage manifest, then make the replay gate pass before enabling any live
transport behavior. Pending legacy gaps should stay explicit in
`coverage.json` rather than being skipped implicitly.
