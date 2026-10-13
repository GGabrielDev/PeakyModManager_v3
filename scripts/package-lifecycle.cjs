const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const previous = path.resolve(process.argv[2] ?? "lifecycle-previous");
const next = path.resolve(process.argv[3] ?? "dist");
const results = [];
fs.mkdirSync("smoke-results", { recursive: true });
try {
  const policy = JSON.parse(fs.readFileSync(path.join(next, "package-evidence.json"), "utf8"));
  for (const [kind, image] of [
    ["deb", "debian:bookworm"],
    ["rpm", "fedora:43"],
    ["arch", "archlinux:base"],
  ]) {
    const result = { kind, image, status: "failed" };
    results.push(result);
    try {
      execFileSync("docker", ["pull", image], { stdio: "inherit" });
      result.imageId = execFileSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], {
        encoding: "utf8",
      }).trim();
      const packageName = kind === "arch" ? `${policy.executable.toLowerCase()}-bin` : policy.targets[kind].name;
      const output = execFileSync(
        "docker",
        [
          "run",
          "--rm",
          "--volume",
          `${previous}:/previous:ro`,
          "--volume",
          `${next}:/next:ro`,
          "--volume",
          `${path.resolve("scripts/package-lifecycle.sh")}:/lifecycle.sh:ro`,
          image,
          "bash",
          "/lifecycle.sh",
          kind,
          packageName,
          policy.executable,
          policy.installName,
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      );
      fs.writeFileSync(`smoke-results/package-lifecycle-${kind}.log`, output);
      result.status = "passed";
    } catch (error) {
      fs.writeFileSync(
        `smoke-results/package-lifecycle-${kind}.log`,
        `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.stack}`
      );
      result.error = error.message;
      process.exitCode = 1;
    }
  }
} catch (error) {
  results.push({ status: "failed", error: error.stack });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    "smoke-results/package-lifecycle.json",
    JSON.stringify(
      {
        results,
        limitations: "Headless package-manager lifecycle only; interactive desktop/browser validation remains pending.",
      },
      null,
      2
    ) + "\n"
  );
}
