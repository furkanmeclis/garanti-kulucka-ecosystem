import { describe, expect, it } from "vitest";

import {
  collectReleaseCommits,
  generateReleaseNotes,
  parseReleaseNoteArgs,
  resolveReleaseRange,
} from "../../tools/release-notes.mjs";

describe("release notes tooling", () => {
  it("resolves the latest semantic tag and its previous tag", () => {
    const range = resolveReleaseRange({}, fakeGitRunner({
      tagList: "v0.1.86\nv0.1.85\nv0.1.84\n",
      logRows: "",
    }));

    expect(range).toEqual({ targetTag: "v0.1.86", previousTag: "v0.1.85" });
  });

  it("supports explicit tag, previous tag, and output arguments", () => {
    expect(parseReleaseNoteArgs(["--tag", "v0.1.86", "--previous", "v0.1.85", "--output", "docs/releases/v0.1.86.md"])).toEqual({
      targetTag: "v0.1.86",
      previousTag: "v0.1.85",
      outputPath: "docs/releases/v0.1.86.md",
    });
  });

  it("renders commits from the target tag diff without merge commits", () => {
    const notes = generateReleaseNotes({ targetTag: "v0.1.86" }, fakeGitRunner({
      tagList: "v0.1.86\nv0.1.85\n",
      logRows: [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\taaaaaaa\tci: include web container artifacts",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tbbbbbbb\tdocs: sync web artifact checkpoint",
      ].join("\n").replaceAll("\t", "\x1f"),
    }));

    expect(notes).toContain("# Release Notes v0.1.86");
    expect(notes).toContain("Range: `v0.1.85..v0.1.86`");
    expect(notes).toContain("- ci: include web container artifacts (`aaaaaaa`)");
    expect(notes).toContain("- docs: sync web artifact checkpoint (`bbbbbbb`)");
    expect(notes).toContain("- Generated from git tag diff.");
  });

  it("rejects missing target tags", () => {
    expect(() => collectReleaseCommits(
      { previousTag: "v0.1.85", targetTag: "v0.1.86" },
      fakeGitRunner({ tagList: "", logRows: "bad-row" }),
    )).toThrow("Unexpected git log row");
  });
});

function fakeGitRunner(responses: { tagList: string; logRows: string }) {
  return (args: string[]) => {
    if (args[0] === "tag") return responses.tagList;
    if (args[0] === "log") return responses.logRows;
    throw new Error(`Unexpected git args: ${args.join(" ")}`);
  };
}
