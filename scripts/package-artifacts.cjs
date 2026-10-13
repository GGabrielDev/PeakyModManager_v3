const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { getConfig } = require("app-builder-lib/out/util/config/config");
const { packagePolicy, validateMetadata, validateDesktop, archRecipe } = require("./package-policy.cjs");
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options });
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function inspect() {
  const config = await getConfig(
    process.cwd(),
    "electron-builder.config.cjs",
    process.argv[2] ? { directories: { output: process.argv[2] } } : null
  );
  const policy = packagePolicy(config, JSON.parse(fs.readFileSync("package.json", "utf8")));
  if (!/^\d+\.\d+\.\d+(?:-preview\.\d+\.[a-f0-9]+)?$/.test(policy.version))
    throw new Error("Unexpected package version");
  const directory = path.resolve(config.directories?.output ?? "dist");
  const names = fs.readdirSync(directory);
  for (const [target, name] of Object.entries(policy.artifacts)) {
    if (!names.includes(name)) throw new Error(`Expected exact ${target} artifact ${name}`);
    const candidates = names.filter((item) => item.endsWith(`.${target}`));
    if (candidates.length !== 1) throw new Error(`Expected exactly one ${target} artifact`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-inspect-"));
  const metadata = {};
  try {
    for (const target of ["deb", "rpm"]) {
      const file = path.join(directory, policy.artifacts[target]);
      const values =
        target === "deb"
          ? ["Package", "Version", "Architecture", "Maintainer", "Depends"].map((field) =>
              run("dpkg-deb", ["--field", file, field]).trim()
            )
          : run("rpm", ["-qp", "--queryformat", "%{NAME}\n%{VERSION}\n%{ARCH}\n%{PACKAGER}\n", file])
              .trim()
              .split("\n");
      const [name, version, architecture, maintainer] = values;
      metadata[target] = {
        name,
        version,
        architecture,
        maintainer,
        dependencies: target === "deb" ? values[4] : run("rpm", ["-qp", "--requires", file]),
      };
      validateMetadata(policy, target, metadata[target]);
      const root = path.join(temporary, target);
      fs.mkdirSync(root);
      if (target === "deb") run("dpkg-deb", ["--extract", file, root]);
      else run("bsdtar", ["-xf", file, "-C", root]);
      validateDesktop(
        policy,
        fs.readFileSync(path.join(root, "usr/share/applications", `${policy.executable}.desktop`), "utf8")
      );
      const icons = run("find", [path.join(root, "usr/share/icons"), "-name", `${policy.executable}.png`]).trim();
      if (!icons) throw new Error(`${target} configured icon missing`);
      if (!fs.existsSync(path.join(root, "opt", policy.installName, policy.executable)))
        throw new Error(`${target} executable missing`);
    }
    const image = path.join(directory, policy.artifacts.AppImage);
    const header = Buffer.alloc(20);
    const descriptor = fs.openSync(image, "r");
    try {
      fs.readSync(descriptor, header, 0, header.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    if (
      header.subarray(0, 4).toString("hex") !== "7f454c46" ||
      header[4] !== 2 ||
      header[5] !== 1 ||
      header.readUInt16LE(18) !== 62
    )
      throw new Error("AppImage must be x86_64 ELF");
    const root = path.join(temporary, "image");
    fs.mkdirSync(root);
    run(image, ["--appimage-extract"], { cwd: root });
    validateDesktop(
      policy,
      fs.readFileSync(path.join(root, "squashfs-root", `${policy.executable}.desktop`), "utf8"),
      true
    );
    for (const name of [policy.executable, `${policy.executable}.png`]) {
      if (!fs.existsSync(path.join(root, "squashfs-root", name))) throw new Error(`AppImage resource missing: ${name}`);
    }
    fs.writeFileSync(path.join(directory, "PKGBUILD"), archRecipe(policy, hash(image)));
    const artifacts = [...Object.values(policy.artifacts), "PKGBUILD"];
    fs.writeFileSync(
      path.join(directory, "SHA256SUMS"),
      artifacts.map((name) => `${hash(path.join(directory, name))}  ${name}`).join("\n") + "\n"
    );
    fs.writeFileSync(
      path.join(directory, "package-evidence.json"),
      JSON.stringify(
        {
          revision: run("git", ["rev-parse", "HEAD"]).trim(),
          ...policy,
          artifacts,
          metadata,
          desktopValidation: "pending: application issue #13",
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
inspect().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
