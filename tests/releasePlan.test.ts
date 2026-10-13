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
    execFileSync(process.execPath, [planner, branch], {
      cwd: directory,
      env: { ...process.env, GITHUB_ACTIONS: "false" },
    });
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
}, 20000);

it("continues after non-fast-forward stable promotion and allows dev synchronization", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-promotion-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
  const commit = (name: string) => {
    fs.writeFileSync(
      path.join(directory, `changes/${name}.json`),
      JSON.stringify({ bump: "patch", summary: name, issue: "https://github.com/owner/app/issues/1" })
    );
    git("add", ".");
    git("commit", "-m", name);
  };
  const run = () => {
    execFileSync(process.execPath, [planner, "dev"], {
      cwd: directory,
      env: { ...process.env, GITHUB_ACTIONS: "false" },
    });
    return JSON.parse(fs.readFileSync(path.join(directory, "release-plan/plan.json"), "utf8"));
  };
  try {
    git("init", "--initial-branch=main");
    fs.writeFileSync(path.join(directory, "package.json"), '{"version":"1.0.0"}');
    fs.writeFileSync(path.join(directory, ".gitignore"), "release-plan/\n");
    fs.mkdirSync(path.join(directory, "changes"));
    git("add", ".");
    git("commit", "-m", "baseline");
    git("checkout", "-b", "dev");
    commit("first");
    git("checkout", "main");
    git("merge", "--no-ff", "dev", "-m", "promotion");
    git("tag", "v1.0.1");
    git("checkout", "dev");
    commit("second");
    const next = run();
    expect(next.version).toMatch(/^1\.0\.2-preview\./);
    expect(next.entries.map((entry: { summary: string }) => entry.summary)).toEqual(["second"]);
    git("checkout", "main");
    git("merge", "--no-ff", "dev", "-m", "second promotion");
    git("tag", "v1.0.2");
    git("checkout", "dev");
    git("merge", "--ff-only", "main");
    const synchronized = run();
    expect(synchronized.version).toMatch(/^1\.0\.3-preview\./);
    expect(synchronized.entries).toEqual([]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

it("uses the recorded source baseline when stable tags exist only in a dedicated release repository", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-destination-plan-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
  const commit = (name: string) => {
    fs.writeFileSync(
      path.join(directory, `changes/${name}.json`),
      JSON.stringify({ bump: "patch", summary: name, issue: "https://github.com/owner/app/issues/1" })
    );
    git("add", ".");
    git("commit", "-m", name);
  };
  const run = (history: { tag: string; revision: string }[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          `console.log(JSON.stringify(require(${JSON.stringify(planner)}).plan('main', 'changes', ${JSON.stringify(history)})))`,
        ],
        { cwd: directory, encoding: "utf8" }
      )
    );
  try {
    git("init", "--initial-branch=main");
    fs.writeFileSync(path.join(directory, "package.json"), '{"version":"1.0.0"}');
    fs.mkdirSync(path.join(directory, "changes"));
    commit("first");
    const first = run([]);
    expect(first.version).toBe("1.0.1");
    commit("second");
    const second = run([{ tag: first.tag, revision: first.revision }]);
    expect(second.version).toBe("1.0.2");
    expect(second.entries.map((entry: { summary: string }) => entry.summary)).toEqual(["second"]);
    expect(second.baselineRevision).toBe(first.revision);
    const rerun = run([
      { tag: first.tag, revision: first.revision },
      { tag: second.tag, revision: second.revision },
    ]);
    expect(rerun.version).toBe(second.version);
    expect(rerun.notes).toBe(second.notes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
