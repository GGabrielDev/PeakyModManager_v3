import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const { nextVersion, parseVersion } = createRequire(import.meta.url)("../scripts/release-plan.cjs");
describe("reviewed release intent", () => {
  it("applies the highest bump and resets lower components", () => {
    expect(nextVersion("1.2.3", ["patch", "minor", "major"])).toBe("2.0.0");
    expect(nextVersion("1.2.3", ["patch", "minor"])).toBe("1.3.0");
    expect(nextVersion("1.2.3", ["patch", "patch"])).toBe("1.2.4");
  });
  it("rejects missing or invalid intent rather than guessing from commits", () => {
    expect(() => nextVersion("1.0.0", [])).toThrow();
    expect(() => nextVersion("1.0.0", ["feature"])).toThrow();
    expect(() => parseVersion("1.0.0-preview.2.abcdef")).toThrow();
  });
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const planner = path.resolve("scripts/release-plan.cjs");
it("uses the baseline then consumes entries only once across stable tags and integration commits", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-plan-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  const entry = (name: string, bump: string) =>
    fs.writeFileSync(
      path.join(directory, `changes/${name}.json`),
      JSON.stringify({
        bump,
        summary: name,
        issue: "https://github.com/owner/repo/issues/1",
      })
    );
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=CI Test", "-c", "user.email=ci@example.invalid", "commit", "-m", "change");
  };
  const run = (branch: string) => {
    execFileSync(process.execPath, [planner, branch], { cwd: directory });
    return JSON.parse(fs.readFileSync(path.join(directory, "release-plan/plan.json"), "utf8"));
  };
  try {
    git("init", "--initial-branch=main");
    fs.writeFileSync(path.join(directory, "package.json"), '{"version":"1.0.0"}');
    fs.writeFileSync(path.join(directory, ".gitignore"), "release-plan/\n");
    fs.mkdirSync(path.join(directory, "changes"));
    entry("first", "minor");
    commit();
    expect(run("main").version).toBe("1.1.0");
    expect(run("dev").version).toMatch(/^1\.1\.0-preview\.1\.[a-f0-9]{12}$/);
    git("tag", "v1.1.0");
    expect(run("main").version).toBe("1.1.0"); // Completed same-revision rerun.
    entry("second", "patch");
    commit();
    const second = run("main");
    expect(second.version).toBe("1.1.1");
    expect(second.entries.map((entry: { summary: string }) => entry.summary)).toEqual(["second"]);
    entry("first", "major");
    expect(() => run("main")).toThrow(); // Previously released entries are immutable.
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
