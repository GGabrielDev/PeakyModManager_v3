import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const { releaseSource } = createRequire(import.meta.url)("../scripts/release-source.cjs");

describe("build-selected release source", () => {
  it("disables local updates even when GitHub repository metadata exists", () => {
    expect(releaseSource({ GITHUB_REPOSITORY: "upstream/app" })).toBeNull();
  });
  it("selects each workflow repository without source edits", () => {
    for (const owner of ["upstream", "fork"]) {
      expect(releaseSource({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: `${owner}/app` })).toEqual({
        provider: "github",
        owner,
        repo: "app",
        channel: "latest",
      });
    }
  });
  it("embeds an explicit override and isolated preview channel", () => {
    expect(releaseSource({ PMM_RELEASE_REPOSITORY: "distributor/releases", PMM_RELEASE_CHANNEL: "preview" })).toEqual({
      provider: "github",
      owner: "distributor",
      repo: "releases",
      channel: "preview",
    });
  });
  it("rejects malformed or empty overrides without falling back", () => {
    for (const repository of ["", "owner", "https://github.com/owner/repo", "owner/repo/extra", "../repo"]) {
      expect(() => releaseSource({ PMM_RELEASE_REPOSITORY: repository })).toThrow();
    }
    expect(() => releaseSource({ PMM_RELEASE_CHANNEL: "beta" })).toThrow();
  });
});

describe("packaged release authority", () => {
  it("derives homepage and repository from the selected distributor", () => {
    const require = createRequire(import.meta.url);
    const previous = process.env.PMM_RELEASE_REPOSITORY;
    process.env.PMM_RELEASE_REPOSITORY = "distributor/releases";
    try {
      delete require.cache[require.resolve("../electron-builder.config.cjs")];
      const config = require("../electron-builder.config.cjs");
      expect(config.extraMetadata.homepage).toBe("https://github.com/distributor/releases");
      expect(config.extraMetadata.repository).toEqual({
        type: "git",
        url: "git+https://github.com/distributor/releases.git",
      });
      expect(config.extraMetadata.pmmUpdateSource).toEqual(config.publish);
    } finally {
      if (previous === undefined) delete process.env.PMM_RELEASE_REPOSITORY;
      else process.env.PMM_RELEASE_REPOSITORY = previous;
      delete require.cache[require.resolve("../electron-builder.config.cjs")];
    }
  });
});
