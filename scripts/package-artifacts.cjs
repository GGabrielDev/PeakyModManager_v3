const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { releaseSource } = require("./release-source.cjs");
const source = releaseSource();
if (!source) throw new Error("Pinned Arch recipe requires an explicit release repository");
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-preview\.\d+\.[a-f0-9]+)?$/.test(version)) throw new Error("Unexpected package version");
const names = fs.readdirSync("dist");
const select = (extension) => {
  const candidates = names.filter((name) => name.endsWith(extension) && name.includes(version));
  if (candidates.length !== 1) throw new Error(`Expected exactly one ${extension} for ${version}`);
  return candidates[0];
};
const image = select(".AppImage"),
  deb = select(".deb"),
  rpm = select(".rpm");
const hash = (name) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join("dist", name)))
    .digest("hex");
const debInfo = execFileSync("dpkg-deb", ["--field", `dist/${deb}`], { encoding: "utf8" });
const rpmInfo = execFileSync(
  "rpm",
  ["-qp", "--queryformat", "%{NAME}\n%{VERSION}\n%{ARCH}\n%{PACKAGER}\n", `dist/${rpm}`],
  { encoding: "utf8" }
);
if (!debInfo.includes("Architecture: amd64") || !debInfo.includes("Maintainer:") || !debInfo.includes("Depends:")) {
  throw new Error("DEB architecture/maintainer/dependencies missing");
}
if (!rpmInfo.includes("x86_64") || !rpmInfo.includes("@")) throw new Error("RPM architecture/packager mismatch");
const desktopFiles = execFileSync("dpkg-deb", ["--contents", `dist/${deb}`], { encoding: "utf8" });
if (!desktopFiles.includes(".desktop") || !desktopFiles.includes("/icons/"))
  throw new Error("DEB desktop/icon metadata missing");
const url = `https://github.com/${source.owner}/${source.repo}/releases/download/v${version}/${image}`;
const recipe = `# Generated for one exact release. This does not publish to AUR.
pkgname=peakymodmanager-v3-bin
pkgver=${version.replaceAll("-", "_")}
pkgrel=1
pkgdesc='Peaky Mod Manager'
arch=('x86_64')
url='https://github.com/${source.owner}/${source.repo}'
license=('MIT')
depends=('gtk3' 'nss' 'libxss' 'alsa-lib')
options=('!strip')
source=('pmm.AppImage::${url}')
sha256sums=('${hash(image)}')
package() {
  chmod +x pmm.AppImage
  ./pmm.AppImage --appimage-extract >/dev/null
  install -d "$pkgdir/opt/peakymodmanager-v3" "$pkgdir/usr/bin"
  cp -a squashfs-root/. "$pkgdir/opt/peakymodmanager-v3/"
  printf '%s\\n' '#!/bin/sh' 'export PMM_PACKAGE_MANAGED=1' 'exec /opt/peakymodmanager-v3/AppRun "$@"' > "$pkgdir/usr/bin/peakymodmanager-v3"
  chmod 755 "$pkgdir/usr/bin/peakymodmanager-v3"
  install -Dm644 squashfs-root/peakymodmanager-v3.desktop "$pkgdir/usr/share/applications/peakymodmanager-v3.desktop"
  sed -i 's|^Exec=.*|Exec=peakymodmanager-v3 %U|' "$pkgdir/usr/share/applications/peakymodmanager-v3.desktop"
  install -Dm644 squashfs-root/peakymodmanager-v3.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/peakymodmanager-v3.png"
}
`;
fs.writeFileSync("dist/PKGBUILD", recipe);
const artifacts = [image, deb, rpm, "PKGBUILD"];
fs.writeFileSync("dist/SHA256SUMS", artifacts.map((name) => `${hash(name)}  ${name}`).join("\n") + "\n");
fs.writeFileSync(
  "dist/package-evidence.json",
  JSON.stringify(
    {
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      version,
      repository: `${source.owner}/${source.repo}`,
      artifacts,
      debInfo,
      rpmInfo,
      desktopValidation: "pending: application issue #13",
    },
    null,
    2
  ) + "\n"
);
