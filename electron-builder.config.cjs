const { releaseSource } = require("./scripts/release-source.cjs");
const source = releaseSource();
module.exports = {
  extends: "./electron-builder.yml",
  publish: source,
  linux: {
    maintainer: process.env.PMM_PACKAGE_MAINTAINER ?? `Peaky <${source?.owner ?? "Peaky"}@users.noreply.github.com>`,
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
