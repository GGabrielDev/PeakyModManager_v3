import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const { packagePolicy, validateMetadata, archRecipe } = createRequire(import.meta.url)("../scripts/package-policy.cjs");
const config = {
  appId: "org.fork.pmm",
  productName: "fork-pmm",
  publish: { owner: "fork", repo: "releases" },
  linux: {
    executableName: "fork-pmm",
    artifactName: "${name}-${version}-${arch}.${ext}",
    maintainer: "Fork <fork@example.org>",
    protocols: [{ schemes: ["forkpmm"] }],
  },
  appImage: { artifactName: "${name}-${version}.${ext}" },
  deb: { packageName: "fork-pmm", depends: ["libgtk-3-0", "libnss3"] },
  rpm: { packageName: "fork-pmm", depends: ["gtk3", "nss"] },
};
const policy = () => packagePolicy(config, { name: "fork-pmm", version: "1.0.0" });
const valid = {
  name: "fork-pmm",
  version: "1.0.0",
  architecture: "amd64",
  maintainer: "Fork <fork@example.org>",
  dependencies: "libgtk-3-0, libnss3",
};

describe("Linux artifact authority and identity", () => {
  it("uses exact builder artifact names and configured identity", () => {
    const p = policy();
    expect(p.artifacts).toEqual({
      AppImage: "fork-pmm-1.0.0.AppImage",
      deb: "fork-pmm-1.0.0-amd64.deb",
      rpm: "fork-pmm-1.0.0-x86_64.rpm",
    });
    const recipe = archRecipe(p, "a".repeat(64));
    expect(recipe).toContain("pkgname=fork-pmm-bin");
    expect(recipe).toContain("/opt/fork-pmm");
    expect(recipe).toContain("fork-pmm.desktop");
    expect(recipe).not.toContain("peakymodmanager-v3");
  });
  it("rejects wrong actual version, identity, architecture, maintainer and dependencies", () => {
    expect(() => validateMetadata(policy(), "deb", valid)).not.toThrow();
    for (const bad of [
      { version: "11.0.0" },
      { name: "unrelated" },
      { architecture: "arm64" },
      { maintainer: "Other <other@example.org>" },
      { dependencies: "fake-lib" },
    ]) {
      expect(() => validateMetadata(policy(), "deb", { ...valid, ...bad })).toThrow();
    }
    expect(() =>
      validateMetadata(policy(), "rpm", { ...valid, architecture: "x86_64", dependencies: "gtk3\nnss" })
    ).not.toThrow();
    expect(() =>
      validateMetadata(policy(), "rpm", { ...valid, architecture: "x86_64", dependencies: "fake-lib" })
    ).toThrow();
  });
});
