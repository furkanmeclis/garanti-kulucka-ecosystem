# Contract Strategy

## Contract Categories

### Frontend API Contracts

The web app talks to backend endpoints only. Every endpoint consumed by the frontend must have:

- Request schema
- Response schema
- Error schema
- Authorization rule
- Example fixture

### Provider Contracts

Provider adapters must preserve legacy behavior for:

- PTT Kargo
- Surat Kargo
- KolayBi
- WhatsApp Cloud API
- Instagram Graph API
- Messenger Graph API
- NetGSM
- Vapi
- SIP/webphone config providers

Provider tests do not use live credentials in CI. They compare generated outbound requests and normalized inbound responses against fixtures.

### Webhook Contracts

Webhook paths and challenge/verification responses must stay compatible with providers.

Webhook tests must cover:

- Verification challenge
- Valid payload
- Duplicate payload
- Unknown account
- Malformed payload
- Provider retry behavior

### Realtime Contracts

Socket.IO event names and payloads live in `packages/shared`.

Every event has:

- Event name
- Direction
- Auth requirement
- Room rule
- Payload schema
- Example fixture

## Fixture Location

```text
contracts/providers/ptt
contracts/providers/surat
contracts/providers/kolaybi
contracts/providers/meta
contracts/providers/netgsm
```

## Contract Test Rule

If an adapter changes an outbound provider payload, the contract fixture must change in the same commit and the reason must be recorded in `docs/contracts`.
