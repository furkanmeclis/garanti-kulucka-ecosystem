# OpenAPI Contracts

This directory contains the backend API contract consumed by the web app.

- `backend-api.json` pins the current backend-owned HTTP route surface.

Rules:

- OpenAPI is generated or validated from shared schemas.
- Frontend clients are generated from this contract.
- Breaking changes must be intentional and documented.
