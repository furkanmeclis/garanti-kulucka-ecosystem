import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredPaths = [
  "docs/roadmap/MASTER_ROADMAP.md",
  "docs/architecture/SYSTEM_ARCHITECTURE.md",
  "docs/admin/ADMIN_CONFIGURATION.md",
  "docs/contracts/CONTRACT_STRATEGY.md",
  "docs/contracts/LEGACY_CONTRACT_INVENTORY.md",
  "contracts/legacy/endpoint-classification.json",
  "docs/testing/TEST_STRATEGY.md",
  "docs/migration/MIGRATOR_DESIGN.md",
  "docs/webphone/WEBPHONE_DESIGN.md",
  "docs/operations/RELEASE_MODEL.md",
  "docs/domain/NAMING_AND_SCHEMA.md",
  "docs/adr/0001-stack-and-runtime.md",
  "docs/adr/0002-admin-managed-settings.md",
  "docs/adr/0003-contract-first-migration.md",
  "apps/api",
  "apps/api/Dockerfile",
  "apps/web",
  "apps/web/Dockerfile",
  "apps/worker",
  "apps/worker/Dockerfile",
  "apps/migrator",
  "apps/migrator/Dockerfile",
  "packages/shared/src/contracts/http",
  "packages/shared/src/contracts/ws",
  "packages/shared/src/contracts/queue",
  "packages/shared/src/contracts/providers",
  "packages/database/migrations/001_initial_canonical_schema.sql",
  "packages/database/src/schema.ts",
  "contracts/openapi",
  "contracts/providers/ptt/fixtures",
  "contracts/providers/ptt/schemas",
  "contracts/providers/surat/fixtures",
  "contracts/providers/surat/schemas",
  "contracts/providers/kolaybi/fixtures",
  "contracts/providers/kolaybi/schemas",
  "contracts/providers/meta/fixtures",
  "contracts/providers/meta/schemas",
  "contracts/providers/netgsm/fixtures",
  "contracts/providers/netgsm/schemas",
  "tests/e2e",
  "tests/contract",
  "tests/integration",
  "tests/migration",
  "tests/websocket",
  "tests/worker",
  "compose.yaml",
  ".env.example",
];

const forbiddenNewSchemaNames = [
  "kullanicilar",
  "musteriler",
  "siparisler",
  "siparis_kalemleri",
  "konusmalar",
  "mesajlar",
  "kargo_gonderimleri",
  "bakiye_hareketleri",
  "ayarlar",
];

const forbiddenSchemaPatterns = [
  /\btimestamp\s+without\s+time\s+zone\b/i,
  /\bserial\b/i,
  /\bbigserial\b/i,
  /\bvarchar\s*\(/i,
  /\bchar\s*\(/i,
  /\bmoney\b/i,
];

const failures = [];

for (const path of requiredPaths) {
  if (!existsSync(join(root, path))) {
    failures.push(`Missing required path: ${path}`);
  }
}

function walk(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if ([".git", "node_modules", "dist", "coverage"].includes(entry)) return [];
      return walk(fullPath);
    }
    return [fullPath];
  });
}

const files = walk(root).filter((file) => /\.(md|sql|ts|tsx|js|mjs|json|yaml|yml)$/.test(file));

for (const file of files) {
  const rel = file.slice(root.length + 1);
  const text = readFileSync(file, "utf8");

  if (rel.startsWith("apps/api") && /migrate\s+--apply|garanti-migrator/.test(text)) {
    failures.push(`API must not invoke migrator commands: ${rel}`);
  }

  if (rel.startsWith("apps/web/src") && /supabase\.(from|auth|channel)|createClient\([^)]*supabase/i.test(text)) {
    failures.push(`Frontend must use backend API clients instead of direct Supabase calls: ${rel}`);
  }

  if (rel.includes("migrations") || rel.includes("schema")) {
    for (const forbidden of forbiddenNewSchemaNames) {
      if (text.includes(forbidden)) {
        failures.push(`New schema file contains legacy identifier "${forbidden}": ${rel}`);
      }
    }

    for (const pattern of forbiddenSchemaPatterns) {
      if (pattern.test(text)) {
        failures.push(`New schema file contains forbidden PostgreSQL pattern ${pattern}: ${rel}`);
      }
    }
  }

  if (/console\.log\([^)]*(TOKEN|SECRET|PASSWORD|ACCESS_TOKEN|API_KEY)/i.test(text)) {
    failures.push(`Potential secret logging pattern: ${rel}`);
  }
}

if (failures.length > 0) {
  console.error("Repository structure verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Repository structure verification passed.");
