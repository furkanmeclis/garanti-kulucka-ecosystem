#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_PERMISSIONS = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
  "pages_messaging",
  "pages_manage_engagement",
  "business_management",
];

/** Walks `root` for `meta-review.json` manifests written by tests/meta-review/recording.ts. */
export function findManifests(root) {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "meta-review.json") {
        const data = JSON.parse(readFileSync(full, "utf8"));
        found.push({ dir, permission: data.permission, title: data.title });
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.permission.localeCompare(b.permission));
}

/** Playwright ships its own ffmpeg; use it for the optional mp4 so nothing else needs installing. */
export function findPlaywrightFfmpeg(home, env) {
  // An explicit override wins; a broken path only costs the mp4 (collect catches the ffmpeg failure).
  if (env.PLAYWRIGHT_FFMPEG) return env.PLAYWRIGHT_FFMPEG;
  const cache = join(home, "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const entry of readdirSync(cache).filter((name) => name.startsWith("ffmpeg-")).sort().reverse()) {
    for (const binary of ["ffmpeg-mac", "ffmpeg-mac-arm64", "ffmpeg-linux", "ffmpeg-win64.exe"]) {
      const full = join(cache, entry, binary);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

export async function collect({ root, outDir, ffmpeg }) {
  mkdirSync(outDir, { recursive: true });
  const manifests = findManifests(root);
  return EXPECTED_PERMISSIONS.map((permission) => {
    const manifest = manifests.find((item) => item.permission === permission);
    const source = manifest ? join(manifest.dir, "video.webm") : null;
    if (!source || !existsSync(source)) return { permission, webm: null, mp4: null };
    const webm = join(outDir, `${permission}.webm`);
    copyFileSync(source, webm);
    let mp4 = null;
    if (ffmpeg) {
      mp4 = join(outDir, `${permission}.mp4`);
      try {
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "pipe" });
      } catch {
        mp4 = null;
      }
    }
    return { permission, webm, mp4 };
  });
}

async function main() {
  const root = resolve("test-results/meta-review");
  const outDir = resolve("tmp/meta-review-videos");
  const ffmpeg = findPlaywrightFfmpeg(homedir(), process.env);
  if (!ffmpeg) console.log("mp4 skipped: no ffmpeg found (set PLAYWRIGHT_FFMPEG to enable)");
  const rows = await collect({ root, outDir, ffmpeg });
  // Playwright's bundled ffmpeg is a VP8/WebM-only build, so H.264 fails there; say so once.
  if (ffmpeg && rows.some((row) => row.webm && !row.mp4)) console.log(`mp4 skipped: ${ffmpeg} cannot encode H.264/MP4 (set PLAYWRIGHT_FFMPEG to a full ffmpeg)`);
  console.log("\nMeta App Review videos");
  for (const row of rows) console.log(`${row.webm ? "OK     " : "MISSING"}  ${row.permission.padEnd(40)}  ${row.webm ?? "-"}  ${row.mp4 ?? ""}`);
  const missing = rows.filter((row) => !row.webm);
  if (missing.length) {
    console.error(`\n${missing.length} video(s) missing`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
