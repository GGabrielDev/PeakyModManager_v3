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
      expect(config.deb.afterRemove).toBe(config.rpm.afterRemove);
      const hook = config.rpm.afterRemove ?? "node_modules/app-builder-lib/templates/linux/after-remove.tpl";
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

it("validates package hook settings against the actual builder schema", async () => {
  const { getConfig, validateConfiguration } = require("app-builder-lib/out/util/config/config");
  const { DebugLogger } = require("builder-util");
  const config = await getConfig(process.cwd(), "electron-builder.config.cjs", null);
  await validateConfiguration(config, new DebugLogger());
});

it.skipIf(process.platform === "win32")(
  "reclaims only empty application directories after final removal",
  () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-package-directory-"));
    try {
      const install = path.join(directory, "install");
      fs.mkdirSync(path.join(install, "resources/nested"), { recursive: true });
      fs.mkdirSync(path.join(directory, "bin"));
      fs.writeFileSync(path.join(directory, "bin/update-alternatives"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const script = fs
        .readFileSync("scripts/linux/after-remove.tpl", "utf8")
        .replaceAll("${executable}", "fork-pmm")
        .replaceAll("/opt/${sanitizedProductName}", install);
      const hook = path.join(directory, "hook.sh");
      fs.writeFileSync(hook, script);
      const run = (argument: string) =>
        execFileSync("bash", [hook, argument], {
          env: { ...process.env, PATH: `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}` },
        });
      run("1");
      expect(fs.existsSync(path.join(install, "resources/nested"))).toBe(true);
      run("0");
      expect(fs.existsSync(install)).toBe(false);
      fs.mkdirSync(path.join(install, "user-added"), { recursive: true });
      fs.mkdirSync(path.join(install, "empty"));
      fs.writeFileSync(path.join(install, "user-added/keep.txt"), "preserved");
      run("0");
      expect(fs.existsSync(path.join(install, "empty"))).toBe(false);
      expect(fs.readFileSync(path.join(install, "user-added/keep.txt"), "utf8")).toBe("preserved");
      fs.rmSync(install, { recursive: true });
      const unrelated = path.join(directory, "other-identity");
      fs.mkdirSync(path.join(unrelated, "empty"), { recursive: true });
      fs.symlinkSync(unrelated, install);
      run("0");
      expect(fs.lstatSync(install).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(unrelated, "empty"))).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  20000
);
