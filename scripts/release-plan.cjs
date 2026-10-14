const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
function parseVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid stable version: ${value}`);
  return match.slice(1).map(Number);
}
function nextVersion(base, bumps) {
  const version = parseVersion(base);
  if (!bumps.length || bumps.some((bump) => !["major", "minor", "patch"].includes(bump))) {
    throw new Error("At least one reviewed major/minor/patch change entry is required");
  }
  const index = bumps.includes("major") ? 0 : bumps.includes("minor") ? 1 : 2;
  version[index]++;
  for (let position = index + 1; position < 3; position++) version[position] = 0;
  return version.join(".");
}
function ownsRelease(body, repository, sourceRepository) {
  const owner = /^Source repository: ([\w.-]+\/[\w.-]+)$/m.exec(body ?? "")?.[1];
  return (
    /^PMM release automation schema: 1$/m.test(body ?? "") &&
    (owner === sourceRepository || (owner === undefined && repository === sourceRepository))
  );
}
function releaseHistory(repository, sourceRepository, revision, branch) {
  const pages = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp"], {
      encoding: "utf8",
    })
  );
  return pages.flat().flatMap((release) => {
    const body = release.body ?? "";
    const sourceRevision = /^Source revision: ([a-f0-9]{40})$/m.exec(body)?.[1];
    const preview = /^v\d+\.\d+\.\d+-preview\.\d+\.[a-f0-9]{12}$/.test(release.tag_name);
    if (
      !sourceRevision ||
      !ownsRelease(body, repository, sourceRepository) ||
      (!preview && !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) ||
      release.prerelease !== preview
    )
      return [];
    let recordedPlan;
    if (
      sourceRevision === revision &&
      preview === (branch === "dev") &&
      release.assets?.some((asset) => asset.name === "release-plan.json")
    ) {
      // A failed download is a planning failure, never permission to invent a new identity.
      recordedPlan = JSON.parse(
        execFileSync(
          "gh",
          [
            "release",
            "download",
            release.tag_name,
            "--repo",
            repository,
            "--pattern",
            "release-plan.json",
            "--output",
            "-",
          ],
          { encoding: "utf8" }
        )
      );
    }
    return [{ tag: release.tag_name, revision: sourceRevision, draft: release.draft, notes: body, plan: recordedPlan }];
  });
}
function compareVersions(left, right) {
  const a = parseVersion(left),
    b = parseVersion(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
function plan(branch, directory = "changes", history = []) {
  if (!["dev", "main"].includes(branch)) throw new Error("Releases originate only from dev or main");
  const currentRevision = git("rev-parse", "HEAD");
  // Published source revisions remain valid baselines even when a promotion merge
  // is not an ancestor of continuing dev, or the release tag lives elsewhere.
  const local = git("tag")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => ({ tag, revision: git("rev-list", "-n", "1", tag) }));
  const matches = [...history, ...local].filter(
    (release) =>
      release.revision === currentRevision &&
      (branch === "dev" ? release.tag.includes("-preview.") : /^v\d+\.\d+\.\d+$/.test(release.tag))
  );
  if (new Set(matches.map((release) => release.tag)).size > 1)
    throw new Error("Multiple release identities exist for this source revision/channel");
  const existing = matches[0];
  if (existing?.plan) {
    const recorded = existing.plan;
    if (
      recorded.revision !== currentRevision ||
      recorded.tag !== existing.tag ||
      recorded.tag !== `v${recorded.version}` ||
      recorded.branch !== branch ||
      recorded.sourceRepository !== process.env.GITHUB_REPOSITORY ||
      recorded.prerelease !== (branch === "dev") ||
      recorded.channel !== (branch === "dev" ? "preview" : "latest") ||
      recorded.notes?.trimEnd() !== existing.notes?.trimEnd()
    )
      throw new Error("Recorded release plan does not match source/release identity");
    return recorded;
  }
  // Legacy releases lack a plan asset. Reconstruct from the preceding stable
  // version, ignoring later promotions, and preserve their recorded notes/tag.
  const targetStable = existing?.tag.split("-preview.")[0];
  const candidates = [...local, ...history].filter(
    (release) =>
      !release.draft &&
      /^v\d+\.\d+\.\d+$/.test(release.tag) &&
      (!targetStable || compareVersions(release.tag, targetStable) < 0)
  );
  candidates.sort((left, right) => compareVersions(left.tag, right.tag));
  const baseline = candidates.at(-1);
  const previous = baseline?.tag;
  const base = previous ?? JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const released = new Set(
    baseline ? git("ls-tree", "-r", "--name-only", baseline.revision, `${directory}/`).split("\n") : []
  );
  const entries = [];
  for (const name of fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const file = `${directory}/${name}`,
      content = fs.readFileSync(file, "utf8");
    if (released.has(file)) {
      if (git("show", `${baseline.revision}:${file}`) !== content.trim())
        throw new Error(`Released entry is immutable: ${file}`);
      continue;
    }
    const entry = JSON.parse(content);
    if (!entry.summary?.trim() || !["major", "minor", "patch"].includes(entry.bump))
      throw new Error(`Malformed change entry: ${file}`);
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+$/.test(entry.issue ?? "")) {
      throw new Error(`Change entry requires originating issue/PR URL: ${file}`);
    }
    entries.push({ ...entry, file });
  }
  // A synchronized dev revision still gets its own preview of the next patch;
  // stable releases and feature-PR metadata continue to require reviewed entries.
  const stable = existing
    ? targetStable.slice(1)
    : nextVersion(base, entries.length ? entries.map((entry) => entry.bump) : branch === "dev" ? ["patch"] : []);
  const revision = git("rev-parse", "HEAD");
  const sequence = Number(git("rev-list", "--count", "HEAD"));
  const version =
    existing?.tag.slice(1) ?? (branch === "dev" ? `${stable}-preview.${sequence}.${revision.slice(0, 12)}` : stable);
  return {
    branch,
    revision,
    sourceRepository: process.env.GITHUB_REPOSITORY ?? null,
    baselineRevision: baseline?.revision ?? null,
    previous: previous ?? null,
    version,
    tag: `v${version}`,
    channel: branch === "dev" ? "preview" : "latest",
    prerelease: branch === "dev",
    entries,
    notes:
      existing?.notes ??
      [
        `Source revision: ${revision}`,
        ...(process.env.GITHUB_REPOSITORY ? [`Source repository: ${process.env.GITHUB_REPOSITORY}`] : []),
        "PMM release automation schema: 1",
        "",
        ...entries.map((entry) => `- ${entry.summary} (${entry.issue}; ${entry.file})`),
        "",
        "Desktop/browser/package compatibility validation remains pending application issue #13.",
      ].join("\n"),
  };
}
module.exports = { parseVersion, nextVersion, plan, releaseHistory, ownsRelease };
if (require.main === module) {
  const repository = process.env.PMM_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY;
  const history =
    process.env.GITHUB_ACTIONS === "true"
      ? releaseHistory(repository, process.env.GITHUB_REPOSITORY, git("rev-parse", "HEAD"), process.argv[2])
      : [];
  const result = plan(process.argv[2], "changes", history);
  fs.mkdirSync("release-plan", { recursive: true });
  fs.writeFileSync("release-plan/plan.json", JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync("release-plan/notes.md", result.notes + "\n");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\ntag=${result.tag}\nchannel=${result.channel}\n`
    );
  }
  console.log(JSON.stringify(result));
}
