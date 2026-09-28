import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

export function parseReleaseNoteArgs(args) {
  const options = {
    targetTag: undefined,
    previousTag: undefined,
    outputPath: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--tag") {
      options.targetTag = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--previous") {
      options.previousTag = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--output") {
      options.outputPath = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.targetTag !== undefined) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    options.targetTag = arg;
  }

  return options;
}

export function resolveReleaseRange(options = {}, runGit = defaultRunGit) {
  const tags = runGit(["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => SEMVER_TAG_PATTERN.test(tag));

  const targetTag = options.targetTag ?? tags[0];
  if (targetTag === undefined) {
    throw new Error("No semantic version tags found. Pass --tag after the first release exists.");
  }

  assertSemverTag(targetTag, "target tag");

  const targetIndex = tags.indexOf(targetTag);
  if (targetIndex === -1) {
    throw new Error(`Target tag ${targetTag} was not found in git tags.`);
  }

  const previousTag = options.previousTag ?? tags[targetIndex + 1];
  if (previousTag === undefined) {
    throw new Error(`No previous semantic version tag found before ${targetTag}. Pass --previous explicitly.`);
  }

  assertSemverTag(previousTag, "previous tag");

  if (!tags.includes(previousTag)) {
    throw new Error(`Previous tag ${previousTag} was not found in git tags.`);
  }

  return { previousTag, targetTag };
}

export function collectReleaseCommits(range, runGit = defaultRunGit) {
  const output = runGit([
    "log",
    "--no-merges",
    "--format=%H%x1f%h%x1f%s",
    `${range.previousTag}..${range.targetTag}`,
  ]);

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject] = line.split("\x1f");
      if (!sha || !shortSha || !subject) {
        throw new Error(`Unexpected git log row: ${line}`);
      }
      return { sha, shortSha, subject };
    });
}

export function renderReleaseNotes({ targetTag, previousTag, commits }) {
  const lines = [
    `# Release Notes ${targetTag}`,
    "",
    `Range: \`${previousTag}..${targetTag}\``,
    "",
    "## Changes",
    "",
  ];

  if (commits.length === 0) {
    lines.push("- No commits found in this tag range.");
  } else {
    for (const commit of commits) {
      lines.push(`- ${escapeMarkdownListText(commit.subject)} (\`${commit.shortSha}\`)`);
    }
  }

  lines.push("", "## Verification", "", "- Generated from git tag diff.");

  return `${lines.join("\n")}\n`;
}

export function generateReleaseNotes(options = {}, runGit = defaultRunGit) {
  const range = resolveReleaseRange(options, runGit);
  const commits = collectReleaseCommits(range, runGit);
  return renderReleaseNotes({ ...range, commits });
}

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function assertSemverTag(tag, label) {
  if (!SEMVER_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid ${label}: ${tag}. Expected vMAJOR.MINOR.PATCH.`);
  }
}

function escapeMarkdownListText(value) {
  return value.replace(/\r?\n/g, " ").replace(/^\s*[-*+]\s+/, "\\- ");
}

function defaultRunGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function printHelp() {
  console.log(`Usage: node tools/release-notes.mjs [tag] [--previous vX.Y.Z] [--output path]

Generates markdown release notes from the git commits between two semantic version tags.

Examples:
  node tools/release-notes.mjs
  node tools/release-notes.mjs v0.1.86
  node tools/release-notes.mjs --tag v0.1.86 --previous v0.1.85
`);
}

async function main() {
  const options = parseReleaseNoteArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const notes = generateReleaseNotes(options);

  if (options.outputPath) {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, notes, "utf8");
    console.log(`Release notes written to ${options.outputPath}`);
    return;
  }

  process.stdout.write(notes);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
