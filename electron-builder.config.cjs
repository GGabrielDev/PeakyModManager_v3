const { releaseSource } = require("./scripts/release-source.cjs");
const source = releaseSource();
module.exports = {
  extends: "./electron-builder.yml",
  publish: source,
  generateUpdatesFilesForAllChannels: false,
  extraMetadata: { pmmUpdateSource: source },
};
