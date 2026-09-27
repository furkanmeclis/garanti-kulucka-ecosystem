# Webphone Design

## Decision

Keep browser SIP/WebRTC as a separate boundary from application realtime.

The frontend may use JsSIP or SIP.js for SIP over WebSocket. The backend does not proxy media.

## Backend Responsibilities

- Authorize whether a user may use webphone.
- Return SIP/WebRTC config assigned to the user.
- Store extension credentials encrypted when managed internally.
- Record call events and call logs.
- Surface admin-editable SIP configuration where safe.

## Backend Non-Responsibilities

- Do not route RTP/audio through API.
- Do not terminate WebRTC media.
- Do not replace the SIP server unless explicitly planned later.

## Test Targets

- User without permission cannot fetch SIP config.
- User with permission gets only their assigned extension config.
- Restart does not lose SIP settings.
- Simulated call events create call logs.
- Frontend config shape remains stable.

## Future PBX Options

- Asterisk with PJSIP WebRTC/WSS
- FreeSWITCH with SIP over WebSocket/WSS

These are future infrastructure choices, not immediate migration blockers.
