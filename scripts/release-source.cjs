function releaseSource(env = process.env) {
  const repository = env.PMM_RELEASE_REPOSITORY ?? (env.GITHUB_ACTIONS === "true" ? env.GITHUB_REPOSITORY : undefined);
  const channel = env.PMM_RELEASE_CHANNEL ?? "latest";
  if (!["latest", "preview"].includes(channel)) {
    throw new Error("PMM_RELEASE_CHANNEL must be latest or preview");
  }
  if (repository === undefined) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)) {
    throw new Error("PMM_RELEASE_REPOSITORY must be OWNER/REPO");
  }
  const [owner, repo] = repository.split("/");
  return { provider: "github", owner, repo, channel };
}
module.exports = { releaseSource };
