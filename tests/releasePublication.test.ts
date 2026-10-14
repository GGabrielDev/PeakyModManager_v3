import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const publisher = path.resolve("scripts/publish-release.cjs");
const revision = "a".repeat(40);
const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), file = 'fake-gh-state.json';
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {calls: [], release: null};
state.calls.push(args);
const value = flag => args[args.indexOf(flag) + 1];
const save = () => fs.writeFileSync(file, JSON.stringify(state));
if (args[0] === 'release' && args[1] === 'view') {
  save(); if (!state.release) process.exit(1); console.log(JSON.stringify(state.release));
} else if (args[0] === 'release' && args[1] === 'create') {
  state.release = {tag_name:args[2], draft:true, prerelease:args.includes('--prerelease'), isDraft:true, body:fs.readFileSync(value('--notes-file'),'utf8'), assets:[]}; save();
} else if (args[0] === 'release' && args[1] === 'upload') {
  fs.mkdirSync('published', {recursive:true});
  for (const file of args.filter(arg => arg.startsWith('release-assets/'))) {
    fs.copyFileSync(file, path.join('published', path.basename(file)));
    state.release.assets.push({name:path.basename(file)});
  }
  save(); if (process.env.FAIL_UPLOAD === 'true') process.exit(1);
} else if (args[0] === 'release' && args[1] === 'edit') {
  if (!args.includes('--draft=false') || !args.some(arg => arg.startsWith('--latest='))) process.exit(2);
  state.release.isDraft = false; state.release.draft = false; save();
} else if (args[0] === 'release' && args[1] === 'delete-asset') {
  state.release.assets = state.release.assets.filter(asset => asset.name !== args[3]);
  fs.rmSync(path.join('published', args[3]), {force:true}); save();
} else if (args[0] === 'release' && args[1] === 'download') {
  if (args.includes('--output')) { save(); if (state.failDownload) process.exit(1); console.log(fs.readFileSync('published/release-plan.json','utf8')); process.exit(0); }
  fs.mkdirSync(value('--dir'), {recursive:true});
  for (const file of fs.readdirSync('published')) fs.copyFileSync(path.join('published',file), path.join(value('--dir'),file));
  save();
} else if (args[0] === 'release' && args[1] === 'delete') { save();
} else if (args[0] === 'api') { save(); if (process.env.FAIL_RETENTION === 'true') process.exit(1); console.log(JSON.stringify([ [...(state.previews || []), ...(state.release ? [state.release] : [])] ]));
} else { save(); process.exit(3); }
`;
function fixture(preview = false, destination = "owner/app") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pmm-publication-test-"));
  const version = preview ? "1.1.0-preview.30.aaaaaaaaaaaa" : "1.1.0";
  const channel = preview ? "preview" : "latest";
  for (const folder of ["bin", "release-plan", "release-assets"]) fs.mkdirSync(path.join(directory, folder));
  fs.writeFileSync(path.join(directory, "bin/gh"), fakeGh, { mode: 0o755 });
  const plan = { sourceRepository: "owner/app", revision, version, tag: `v${version}`, channel, prerelease: preview };
  fs.writeFileSync(path.join(directory, "release-plan/plan.json"), JSON.stringify(plan));
  fs.writeFileSync(
    path.join(directory, "release-plan/notes.md"),
    `Source revision: ${revision}\nSource repository: owner/app\nPMM release automation schema: 1\n`
  );
  for (const extension of ["AppImage", "deb", "rpm", "exe"]) {
    fs.writeFileSync(path.join(directory, `release-assets/pmm-${version}.${extension}`), `fixture:${extension}`);
  }
  fs.writeFileSync(path.join(directory, "release-assets/PKGBUILD"), "checksum-pinned fixture");
  for (const suffix of ["", "-linux"])
    fs.writeFileSync(path.join(directory, `release-assets/${channel}${suffix}.yml`), `version: ${version}\n`);
  const environment = {
    ...process.env,
    PATH: `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`,
    GITHUB_SHA: revision,
    GITHUB_REPOSITORY: "owner/app",
    PMM_RELEASE_REPOSITORY: destination,
    GH_TOKEN: "fixture-not-a-real-token",
  };
  const run = (failUpload = false, failRetention = false) =>
    execFileSync(process.execPath, [publisher], {
      cwd: directory,
      env: { ...environment, FAIL_UPLOAD: String(failUpload), FAIL_RETENTION: String(failRetention) },
      stdio: "pipe",
    });
  const history = (branch: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          `console.log(JSON.stringify(require(${JSON.stringify(path.resolve("scripts/release-plan.cjs"))}).releaseHistory(${JSON.stringify(destination)}, 'owner/app', ${JSON.stringify(revision)}, ${JSON.stringify(branch)})))`,
        ],
        { cwd: directory, env: environment, stdio: "pipe" }
      ).toString()
    );
  const state = () => JSON.parse(fs.readFileSync(path.join(directory, "fake-gh-state.json"), "utf8"));
  return { directory, run, state, history };
}
// Publication runs on Linux. The local CLI fixture uses a POSIX executable.
describe.skipIf(process.platform === "win32")("staged publication and recovery", () => {
  it("publishes only after draft upload, includes source checksums and makes completed reruns a no-op", () => {
    const f = fixture();
    try {
      f.run();
      const initial = f.state();
      expect(initial.release.isDraft).toBe(false);
      const operations = initial.calls.map((args: string[]) => args[1]);
      expect(operations.indexOf("create")).toBeLessThan(operations.indexOf("upload"));
      expect(operations.indexOf("upload")).toBeLessThan(operations.indexOf("edit"));
      expect(fs.readFileSync(path.join(f.directory, "published/SHA256SUMS"), "utf8")).toContain(
        "  source-revision.txt"
      );
      f.run();
      expect(f.state().calls.filter((args: string[]) => args[1] === "edit")).toHaveLength(1);
      fs.writeFileSync(path.join(f.directory, "published/pmm-1.1.0.exe"), "corrupted");
      expect(() => f.run()).toThrow();
    } finally {
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  }, 20000);
  it("leaves failed uploads as drafts and recovers partial assets without mixing revisions", () => {
    const f = fixture();
    try {
      expect(() => f.run(true)).toThrow();
      expect(f.state().release.isDraft).toBe(true);
      f.run();
      expect(f.state().release.isDraft).toBe(false);
      expect(f.state().calls.some((args: string[]) => args[1] === "delete-asset")).toBe(true);
    } finally {
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  }, 20000);
  it("retries retention after a completed preview rerun", () => {
    const f = fixture(true);
    try {
      expect(() => f.run(false, true)).toThrow();
      expect(f.state().release.isDraft).toBe(false);
      const before = f.state().calls.filter((args: string[]) => args[0] === "api").length;
      f.run();
      expect(f.state().calls.filter((args: string[]) => args[0] === "api").length).toBe(before + 1);
      expect(f.state().calls.filter((args: string[]) => args[1] === "edit")).toHaveLength(1);
    } finally {
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  }, 20000);
  it("prunes only owned obsolete previews while preserving stable and foreign releases", () => {
    const f = fixture(true);
    try {
      const previews = Array.from({ length: 25 }, (_, index) => ({
        tag_name: `v1.1.0-preview.${index + 1}.aaaaaaaaaaaa`,
        draft: false,
        prerelease: true,
        body: `Source revision: ${revision}\nSource repository: owner/app\nPMM release automation schema: 1\n`,
      }));
      fs.writeFileSync(
        path.join(f.directory, "fake-gh-state.json"),
        JSON.stringify({
          calls: [],
          release: null,
          previews: [
            ...previews,
            { tag_name: "v1.0.0", draft: false, prerelease: false, body: "stable" },
            { tag_name: "v1.1.0-preview.1.bbbbbbbbbbbb", draft: false, prerelease: true, body: "foreign" },
          ],
        })
      );
      f.run();
      const deletions = f
        .state()
        .calls.filter((args: string[]) => args[1] === "delete")
        .map((args: string[]) => args[2]);
      expect(deletions).toHaveLength(6);
      expect(deletions).toContain("v1.1.0-preview.1.aaaaaaaaaaaa");
      expect(deletions).not.toContain("v1.0.0");
      expect(deletions).not.toContain("v1.1.0-preview.1.bbbbbbbbbbbb");
    } finally {
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  }, 20000);
});

describe.skipIf(process.platform === "win32")("preview retention ownership and historical recovery", () => {
  it.each(["owner/app", "owner/releases"])(
    "preserves foreign and active previews in %s",
    (destination) => {
      const f = fixture(true, destination);
      try {
        f.run();
        const state = f.state();
        const release = (sequence: number, owner: string | null) => ({
          tag_name: `v1.1.0-preview.${sequence}.bbbbbbbbbbbb`,
          draft: false,
          prerelease: true,
          body: `Source revision: ${"b".repeat(40)}\n${owner ? `Source repository: ${owner}\n` : ""}PMM release automation schema: 1\n`,
        });
        state.calls = [];
        state.previews = [
          ...Array.from({ length: 25 }, (_, index) => release(index + 31, "owner/app")),
          release(1, "another/fork"),
          release(2, null),
          { ...release(3, "owner/app"), draft: true },
          { ...release(4, "owner/app"), prerelease: false, tag_name: "v1.0.0" },
        ];
        fs.writeFileSync(path.join(f.directory, "fake-gh-state.json"), JSON.stringify(state));
        f.run();
        const deleted = f
          .state()
          .calls.filter((args: string[]) => args[1] === "delete")
          .map((args: string[]) => args[2]);
        expect(deleted).not.toContain(state.release.tag_name);
        expect(deleted).not.toContain(state.previews[25].tag_name);
        expect(deleted).not.toContain(state.previews[27].tag_name);
        expect(deleted).not.toContain("v1.0.0");
        // Markerless legacy ownership is bounded to the source repository itself.
        expect(deleted.includes(state.previews[26].tag_name)).toBe(destination === "owner/app");
        expect(deleted).toHaveLength(destination === "owner/app" ? 6 : 5);
        expect(f.state().calls.filter((args: string[]) => args[1] === "edit")).toHaveLength(0);
      } finally {
        fs.rmSync(f.directory, { recursive: true, force: true });
      }
    },
    20000
  );
});

describe.skipIf(process.platform === "win32")("recorded plan discovery", () => {
  it.each([false, true])(
    "loads exact source/channel plans including recoverable drafts (preview=%s)",
    (preview) => {
      const f = fixture(preview, "owner/releases");
      try {
        f.run();
        const state = f.state();
        state.release.draft = true;
        state.previews = [
          { ...state.release, body: state.release.body.replace("owner/app", "another/fork") },
          { ...state.release, body: state.release.body.replace("Source repository: owner/app\n", "") },
          {
            ...state.release,
            tag_name: "v9.0.0",
            prerelease: false,
            draft: false,
            body: state.release.body.replace(revision, "b".repeat(40)),
          },
        ];
        state.calls = [];
        fs.writeFileSync(path.join(f.directory, "fake-gh-state.json"), JSON.stringify(state));
        const history = f.history(preview ? "dev" : "main");
        expect(history).toHaveLength(2);
        const exact = history.find((release: { revision: string }) => release.revision === revision);
        expect(exact.draft).toBe(true);
        expect(exact.plan).toEqual(
          JSON.parse(fs.readFileSync(path.join(f.directory, "release-plan/plan.json"), "utf8"))
        );
        expect(f.state().calls.filter((args: string[]) => args[1] === "download")).toHaveLength(1);
        state.failDownload = true;
        fs.writeFileSync(path.join(f.directory, "fake-gh-state.json"), JSON.stringify(state));
        expect(() => f.history(preview ? "dev" : "main")).toThrow();
        state.release.assets = [];
        fs.writeFileSync(path.join(f.directory, "fake-gh-state.json"), JSON.stringify(state));
        const legacy = f
          .history(preview ? "dev" : "main")
          .find((release: { revision: string }) => release.revision === revision);
        expect(legacy.plan).toBeUndefined();
        expect(legacy.notes).toBe(state.release.body);
      } finally {
        fs.rmSync(f.directory, { recursive: true, force: true });
      }
    },
    20000
  );
});
