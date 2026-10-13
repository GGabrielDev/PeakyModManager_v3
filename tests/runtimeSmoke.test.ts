import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("packaged smoke failure evidence", () => {
  it("records missing executable and non-Git invocation failures", () => {
    const script = path.resolve("scripts/smoke/linux-runtime.mjs");
    for (const outsideGit of [false, true]) {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-smoke-preflight-"));
      if (!outsideGit) spawnSync("git", ["init", "--initial-branch=main"], { cwd: work });
      if (!outsideGit)
        spawnSync(
          "git",
          ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture"],
          { cwd: work }
        );
      const cwd = work;
      try {
        const result = spawnSync(process.execPath, [script, path.join(work, "missing-executable")], {
          cwd,
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        const evidence = JSON.parse(fs.readFileSync(path.join(cwd, "smoke-results/linux-runtime.json"), "utf8"));
        expect(evidence.status).toBe("failed");
        expect(evidence.error).toMatch(outsideGit ? /git|repository/ : /ENOENT|missing-executable/);
        expect(evidence.diagnostics).toContain("packaged executable");
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
  });
});
