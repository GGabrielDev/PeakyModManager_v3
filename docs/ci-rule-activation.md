# Maintainer activation and verification for issue #15

Prepared for `GGabrielDev/PeakyModManager_v3`. The dev integration branch was created without rewriting history from main revision `4934fc88da5ab637d28e1a7c219be09a792be2a1`. Repository Actions is enabled; the authenticated maintainer account reports admin/write access. Workflow-edit permission required refreshing the OAuth token's `workflow` scope. Read-only settings checks returned no rulesets and HTTP 404 “Branch not protected” for classic main protection. No rule settings, bypass policy or release credentials were changed. This preparation does not close the human-owned activation issue.

Merge the CI implementation stack into dev in dependency order. Retarget downstream PRs to dev after their parent merges, then make a reviewed dev-to-main promotion. Main does not contain the new trusted workflow initially: the maintainer must choose and record a one-time bootstrap path before making it required. Do not require a check that has never run on its target or bypass a failing test under the name of bootstrap.

In Settings → Rules → Rulesets (or classic branch protections where appropriate), protect dev and main; require pull requests, block branch deletion/force pushes, and require these GitHub Actions check identities:

| Required identity        | Purpose                                        | Trust                                                                                                      |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Required CI              | Aggregate actual source/package/runtime checks | PR code; validate workflow changes during review                                                           |
| Trusted promotion source | Reject feature/fork branches targeting main    | Target-branch metadata-only pull_request_target workflow; no checkout, code execution or token permissions |

Select GitHub Actions as the expected status source. Keep job names unique. Protect workflow modifications with required maintainer review; simply selecting the GitHub Actions app does not make arbitrary quality-check code uneditable by a PR. If the repository's plan/ownership supports organization required workflows, use a controlled source for the aggregate validation as well. Otherwise record that limitation and require code-owner review of `.github/workflows/`, build/release scripts, package scripts and test configuration. This user-owned repository's organization-required-workflow capability has not been established. [GitHub rules reference](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

Record whether administrators/apps may bypass and exactly why. Default normal contributor flow must block direct main pushes, feature-to-main and fork-dev-to-main PRs. Do not enable merge queue without adding and validating merge_group triggers in the workflows; this initial implementation uses ordinary PR merges. Stable publication runs after a permitted dev promotion and required push checks, not as a way to undo a forbidden push.

Read-only settings evidence from the parent workspace:

```bash
gh api repos/GGabrielDev/PeakyModManager_v3/rulesets
gh api repos/GGabrielDev/PeakyModManager_v3/branches/main/protection
gh api repos/GGabrielDev/PeakyModManager_v3/actions/permissions
gh pr checks NUMBER --repo GGabrielDev/PeakyModManager_v3
gh run list --repo GGabrielDev/PeakyModManager_v3 --workflow ci.yml
```

Use a disposable repository with matching rules and non-admin contributor permissions to verify refusal of a direct main push, a feature PR to main, and a fork branch named dev to main. Verify same-repository dev to main succeeds with passing checks; introduce an intentionally failing test/format check and verify the aggregate fails and merge is blocked. Record run/PR URLs, acting role, required check source, repository plan and any bypass used. No destructive negative test should be performed against production history.

After activation, save the resulting rules/protection JSON and check identities with links to the verification runs in issue #15. If a required job is renamed or missing, restore its original identity or deliberately migrate the rule and workflow together; never remove a required failure merely to unblock a merge. For preview/stable triggers and partial-release recovery see [CI and releases](ci-releases.md). Credentials for a dedicated release repository are optional setup and do not belong in source or issue evidence.
