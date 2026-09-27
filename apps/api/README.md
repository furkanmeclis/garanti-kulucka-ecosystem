# API

Hono + TypeScript HTTP API container.

Bu katman frontend'in tek HTTP kaynagi olacak. Eski Supabase dogrudan cagri modeli burada sonlanir.

## Manual Bootstrap

First admin creation is a manual operation:

```bash
FIRST_ADMIN_EMAIL=admin@example.com FIRST_ADMIN_PASSWORD='change-this-long-password' npm run bootstrap:admin
```

The command requires `DATABASE_URL` and never stores a password in migrations.
