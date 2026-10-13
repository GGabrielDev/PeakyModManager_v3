const { releaseSource } = require("./scripts/release-source.cjs");
const source = releaseSource();
module.exports = {
  extends: "./electron-builder.yml",
  publish: source,
  linux: {
    afterRemove: "scripts/linux/after-remove.tpl",
    maintainer: process.env.PMM_PACKAGE_MAINTAINER ?? `Peaky <${source?.owner ?? "Peaky"}@users.noreply.github.com>`,
  },
  deb: {
    depends: [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6",
      "xdg-utils",
      "libatspi2.0-0",
      "libuuid1",
      "libsecret-1-0",
    ],
  },
  rpm: {
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libXScrnSaver",
      "libXtst",
      "xdg-utils",
      "at-spi2-core",
      "libuuid",
      "libsecret",
    ],
  },
  generateUpdatesFilesForAllChannels: false,
  extraMetadata: {
    pmmUpdateSource: source,
    ...(source && {
      homepage: `https://github.com/${source.owner}/${source.repo}`,
      repository: { type: "git", url: `git+https://github.com/${source.owner}/${source.repo}.git` },
    }),
  },
};
