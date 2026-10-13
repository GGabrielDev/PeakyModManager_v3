const { AppInfo } = require("app-builder-lib/out/appInfo");
const { expandMacro } = require("app-builder-lib/out/util/macroExpander");
const { Arch, getArtifactArchName } = require("builder-util");

function packagePolicy(config, metadata) {
  const linux = config.linux;
  const app = new AppInfo({ config, metadata: { ...metadata, ...config.extraMetadata } }, undefined, linux);
  const executable = linux.executableName ?? config.executableName ?? app.sanitizedProductName.toLowerCase();
  const installName = app.sanitizedProductName;
  for (const name of [executable, installName]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
      throw new Error("Linux resource names must be shell-safe identities");
  }
  const artifacts = Object.fromEntries(
    ["AppImage", "deb", "rpm"].map((target) => {
      const options = config[target === "AppImage" ? "appImage" : target] ?? {};
      const pattern = options.artifactName ?? linux.artifactName ?? config.artifactName;
      if (!pattern) throw new Error(`Explicit artifactName required for ${target}`);
      return [target, expandMacro(pattern, getArtifactArchName(Arch.x64, target), app, { ext: target, os: "linux" })];
    })
  );
  const schemes = (linux.protocols ?? config.protocols ?? []).flatMap((protocol) => protocol.schemes);
  if (!schemes.length) throw new Error("Configured protocol schemes required");
  const targets = Object.fromEntries(
    ["deb", "rpm"].map((target) => {
      const options = { ...linux, ...config[target] };
      if (!Array.isArray(options.depends) || !options.depends.length)
        throw new Error(`Explicit ${target} dependencies required`);
      return [
        target,
        {
          name: options.packageName ?? app.linuxPackageName,
          maintainer: options.maintainer,
          dependencies: options.depends,
        },
      ];
    })
  );
  const source = config.publish;
  if (!source?.owner || !source?.repo)
    throw new Error("Pinned Arch recipe requires a selected GitHub release repository");
  return {
    version: app.version,
    name: app.name,
    buildVersion: app.buildVersion,
    appId: app.id,
    appImageExec: `AppRun ${(config.appImage?.executableArgs ?? linux.executableArgs)?.join(" ") || "--no-sandbox"} %U`,
    executable,
    installName,
    artifacts,
    schemes,
    targets,
    source,
  };
}
function validateMetadata(policy, target, actual) {
  const expected = policy.targets[target];
  const fields = {
    name: expected.name,
    version: policy.version.replaceAll("-", "~"),
    architecture: target === "deb" ? "amd64" : "x86_64",
    maintainer: expected.maintainer,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (actual[key] !== value) throw new Error(`${target} ${key}: expected ${value}, got ${actual[key]}`);
  }
  const dependencyNames = actual.dependencies.split(/[,\n]/).map((item) => item.trim().split(/[\s(]/)[0]);
  for (const dependency of expected.dependencies) {
    if (!dependencyNames.includes(dependency.split(/[\s(]/)[0]))
      throw new Error(`${target} missing dependency ${dependency}`);
  }
}
function validateDesktop(policy, content, image = false) {
  const fields = Object.fromEntries(
    content
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      })
  );
  const expectedExec = image ? policy.appImageExec : `/opt/${policy.installName}/${policy.executable} %U`;
  if (fields.Icon !== policy.executable || fields.Exec?.replaceAll('"', "") !== expectedExec)
    throw new Error("Desktop executable/icon identity mismatch");
  if (image && fields["X-AppImage-Version"] !== policy.buildVersion)
    throw new Error("AppImage version metadata mismatch");
  for (const scheme of policy.schemes) {
    if (!fields.MimeType?.split(";").includes(`x-scheme-handler/${scheme}`))
      throw new Error(`Desktop protocol ${scheme} missing`);
  }
}
function archRecipe(policy, checksum) {
  const { executable: name, installName, version, source } = policy;
  return `# Generated for one exact release. This does not publish to AUR.
pkgname=${name.toLowerCase()}-bin
pkgver=${version.replaceAll("-", "_")}
pkgrel=1
pkgdesc='Peaky Mod Manager'
arch=('x86_64')
url='https://github.com/${source.owner}/${source.repo}'
license=('MIT')
depends=('gtk3' 'nss' 'libxss' 'alsa-lib')
options=('!strip')
source=('pmm.AppImage::https://github.com/${source.owner}/${source.repo}/releases/download/v${version}/${policy.artifacts.AppImage}')
sha256sums=('${checksum}')
package() {
  chmod +x pmm.AppImage
  ./pmm.AppImage --appimage-extract >/dev/null
  install -d "$pkgdir/opt/${installName}" "$pkgdir/usr/bin"
  cp -a squashfs-root/. "$pkgdir/opt/${installName}/"
  printf '%s\\n' '#!/bin/sh' 'export PMM_PACKAGE_MANAGED=1' 'exec /opt/${installName}/AppRun "$@"' > "$pkgdir/usr/bin/${name}"
  chmod 755 "$pkgdir/usr/bin/${name}"
  install -Dm644 squashfs-root/${name}.desktop "$pkgdir/usr/share/applications/${name}.desktop"
  sed -i 's|^Exec=.*|Exec=${name} %U|' "$pkgdir/usr/share/applications/${name}.desktop"
  install -Dm644 squashfs-root/${name}.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/${name}.png"
}
`;
}
function validateApplication(policy, metadata) {
  if (metadata.version !== policy.version || metadata.name !== policy.name)
    throw new Error("Packaged application name/version mismatch");
  const homepage = `https://github.com/${policy.source.owner}/${policy.source.repo}`;
  if (metadata.homepage !== homepage || metadata.repository?.url !== `git+${homepage}.git`)
    throw new Error("Packaged application release authority mismatch");
  for (const key of ["owner", "repo", "channel"]) {
    if (metadata.pmmUpdateSource?.[key] !== policy.source[key])
      throw new Error(`Packaged update source ${key} mismatch`);
  }
}
module.exports = { packagePolicy, validateMetadata, validateDesktop, validateApplication, archRecipe };
