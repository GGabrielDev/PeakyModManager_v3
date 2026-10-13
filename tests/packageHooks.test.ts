import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);

describe.skipIf(process.platform === "win32")("native package removal hooks", () => {
  it("keeps alternatives during upgrades and removes the registered identity on uninstall", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-package-hook-"));
    try {
      const config = require("../electron-builder.config.cjs");
      const hook = config.linux.afterRemove ?? "node_modules/app-builder-lib/templates/linux/after-remove.tpl";
      const script = fs
        .readFileSync(hook, "utf8")
        .replaceAll("${executable}", "fork-pmm")
        .replaceAll("${sanitizedProductName}", "fork-install");
      fs.writeFileSync(path.join(directory, "hook.sh"), script);
      fs.mkdirSync(path.join(directory, "bin"));
      fs.writeFileSync(
        path.join(directory, "bin/update-alternatives"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PMM_HOOK_CALLS"\n',
        { mode: 0o755 }
      );
      const calls = path.join(directory, "calls");
      const run = (argument: string) =>
        execFileSync("bash", [path.join(directory, "hook.sh"), argument], {
          env: {
            ...process.env,
            PATH: `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`,
            PMM_HOOK_CALLS: calls,
          },
        });
      for (const argument of ["1", "2", "upgrade", "failed-upgrade"]) run(argument);
      expect(fs.existsSync(calls)).toBe(false);
      for (const argument of ["0", "remove", "purge"]) run(argument);
      expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toEqual(
        Array(3).fill("--remove fork-pmm /opt/fork-install/fork-pmm")
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
