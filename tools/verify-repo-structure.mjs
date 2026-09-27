import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredPaths = [
  "docs/roadmap/MASTER_ROADMAP.md",
  "docs/architecture/SYSTEM_ARCHITECTURE.md",
  "docs/admin/ADMIN_CONFIGURATION.md",
  "docs/contracts/CONTRACT_STRATEGY.md",
  "docs/testing/TEST_STRATEGY.md",
  "docs/migration/MIGRATOR_DESIGN.md",
  "docs/webphone/WEBPHONE_DESIGN.md",
  "docs/operations/RELEASE_MODEL.md",
  "docs/domain/NAMING_AND_SCHEMA.md",
  "docs/adr/0001-stack-and-runtime.md",
  "docs/adr/0002-admin-managed-settings.md",
  "docs/adr/0003-contract-first-migration.md",
  "apps/api",
  "apps/web",
  "apps/worker",
  "apps/migrator",
  "packages/shared/src/contracts/http",
  "packages/shared/src/contracts/ws",
  "packages/shared/src/contracts/queue",
  "packages/shared/src/contracts/providers",
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

  if (rel.includes("migrations") || rel.includes("schema")) {
    for (const forbidden of forbiddenNewSchemaNames) {
      if (text.includes(forbidden)) {
        failures.push(`New schema file contains legacy identifier "${forbidden}": ${rel}`);
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
