const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const packageFile = fs.readFileSync("package.json");
const lockFile = fs.readFileSync("package-lock.json");
try {
  execFileSync("npm", ["version", "0.0.0", "--no-git-tag-version", "--allow-same-version"], { stdio: "inherit" });
  execFileSync(
    "npx",
    [
      "electron-builder",
      "--config",
      "electron-builder.config.cjs",
      "--linux",
      "AppImage",
      "deb",
      "rpm",
      "--x64",
      "--publish=never",
      "--prepackaged=dist/linux-unpacked",
      "--config.directories.output=lifecycle-previous",
    ],
    { stdio: "inherit" }
  );
  execFileSync(process.execPath, ["scripts/package-artifacts.cjs", "lifecycle-previous"], { stdio: "inherit" });
} finally {
  fs.writeFileSync("package.json", packageFile);
  fs.writeFileSync("package-lock.json", lockFile);
}
