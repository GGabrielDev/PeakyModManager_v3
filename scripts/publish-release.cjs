const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ownsRelease } = require("./release-plan.cjs");
const plan = JSON.parse(fs.readFileSync("release-plan/plan.json", "utf8"));
const repository = process.env.PMM_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Publication repository must be OWNER/REPO");
if (plan.sourceRepository !== process.env.GITHUB_REPOSITORY) throw new Error("Plan/source repository mismatch");
if (plan.revision !== process.env.GITHUB_SHA) throw new Error("Plan/revision mismatch");
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
fs.writeFileSync("release-assets/release-plan.json", JSON.stringify(plan, null, 2) + "\n");
fs.writeFileSync("release-assets/source-revision.txt", plan.revision + "\n");
fs.writeFileSync(
  "release-assets/release-baseline.json",
  JSON.stringify(
    { schema: 1, version: plan.version, revision: plan.revision, sourceRepository: process.env.GITHUB_REPOSITORY },
    null,
    2
  ) + "\n"
);
const files = fs
  .readdirSync("release-assets")
  .filter((name) => fs.statSync(path.join("release-assets", name)).isFile());
for (const suffix of [".AppImage", ".deb", ".rpm", ".exe"]) {
  if (!files.some((name) => name.includes(plan.version) && name.endsWith(suffix)))
    throw new Error(`Missing ${suffix} for this version`);
}
for (const name of ["PKGBUILD", `${plan.channel}.yml`, `${plan.channel}-linux.yml`]) {
  if (!files.includes(name)) throw new Error(`Missing release asset ${name}`);
}
for (const name of files.filter((name) => name.endsWith(".yml"))) {
  const contents = fs.readFileSync(path.join("release-assets", name), "utf8");
  if (!contents.includes(`version: ${plan.version}`)) throw new Error(`Metadata/version mismatch: ${name}`);
  if (plan.prerelease && name.startsWith("latest")) throw new Error("Preview must not publish stable metadata");
}
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(
  "release-assets/SHA256SUMS",
  files
    .filter((name) => name !== "SHA256SUMS")
    .sort()
    .map((name) => `${digest(path.join("release-assets", name))}  ${name}`)
    .join("\n") + "\n"
);
const releaseArgs = ["--repo", repository];
let existing;
try {
  existing = JSON.parse(
    gh("release", "view", plan.tag, ...releaseArgs, "--json", "isDraft,body,assets,targetCommitish")
  );
} catch {
  /* create below; an API error also fails creation */
}
if (
  existing &&
  (!ownsRelease(existing.body, repository, process.env.GITHUB_REPOSITORY) ||
    !new RegExp(`^Source revision: ${plan.revision}$`, "m").test(existing.body))
)
  throw new Error("Existing release belongs to a different revision");
if (existing && !existing.isDraft) {
  // Verify published checksums rather than comparing fresh non-reproducible installers.
  fs.mkdirSync("release-existing", { recursive: true });
  gh("release", "download", plan.tag, ...releaseArgs, "--dir", "release-existing", "--clobber");
  if (fs.readFileSync("release-existing/source-revision.txt", "utf8").trim() !== plan.revision) {
    throw new Error("Completed release source mismatch");
  }
  for (const line of fs.readFileSync("release-existing/SHA256SUMS", "utf8").trim().split("\n")) {
    const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/.exec(line);
    if (!match) throw new Error("Malformed completed release checksum");
    const actual = digest(path.join("release-existing", match[2]));
    if (actual !== match[1]) throw new Error(`Published asset checksum differs: ${match[2]}`);
  }
  console.log("This revision is already published with identical assets.");
  retainPreviews();
  process.exit(0);
}
if (!existing) {
  const target =
    repository === process.env.GITHUB_REPOSITORY
      ? plan.revision
      : gh("api", `repos/${repository}`, "--jq", ".default_branch");
  gh(
    "release",
    "create",
    plan.tag,
    ...releaseArgs,
    "--target",
    target,
    "--title",
    plan.tag,
    "--notes-file",
    "release-plan/notes.md",
    "--draft",
    ...(plan.prerelease ? ["--prerelease"] : [])
  );
} else {
  // Recover only our own draft, removing partial assets before uploading the complete set.
  for (const asset of existing.assets) gh("release", "delete-asset", plan.tag, asset.name, ...releaseArgs, "--yes");
}
gh(
  "release",
  "upload",
  plan.tag,
  ...releaseArgs,
  ...fs.readdirSync("release-assets").map((name) => path.join("release-assets", name))
);
gh("release", "edit", plan.tag, ...releaseArgs, "--draft=false", `--latest=${!plan.prerelease}`);
retainPreviews();
function retainPreviews() {
  if (!plan.prerelease) return;
  const releases = JSON.parse(gh("api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp")).flat();
  const owned = releases.filter(
    (release) =>
      !release.draft &&
      release.prerelease &&
      /^v\d+\.\d+\.\d+-preview\.\d+\.[a-f0-9]{12}$/.test(release.tag_name) &&
      /^Source revision: [a-f0-9]{40}$/m.test(release.body ?? "") &&
      ownsRelease(release.body, repository, process.env.GITHUB_REPOSITORY)
  );
  const order = (tag) =>
    tag
      .match(/^v(\d+)\.(\d+)\.(\d+)-preview\.(\d+)/)
      .slice(1)
      .map(Number);
  owned.sort((a, b) => {
    const left = order(a.tag_name),
      right = order(b.tag_name);
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return 0;
  });
  for (const release of owned.slice(20).filter((release) => release.tag_name !== plan.tag)) {
    gh("release", "delete", release.tag_name, ...releaseArgs, "--yes", "--cleanup-tag");
  }
}
