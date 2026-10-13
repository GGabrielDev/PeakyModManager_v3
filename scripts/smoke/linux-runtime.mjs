/* eslint @typescript-eslint/explicit-function-return-type: "off" */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const executable = path.resolve(process.argv[2] ?? "dist/linux-unpacked/peakymodmanager-v3");
const packageRoot = path.dirname(executable);
let work, library, profile;
const evidence = {
  executable,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  checks: [],
  manual: [
    "desktop registration",
    "interactive browsers",
    "X11/Wayland focus",
    "N→N+1 updater replacement",
    "Steam discovery (issue #14)",
  ],
};
let app, socket, server;
let logs = "";
let env;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(callback, description, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await callback();
      if (result) return result;
    } catch {
      /* wait for startup */
    }
    if (app && (app.exitCode !== null || app.signalCode !== null))
      throw new Error(`Packaged app exited (${app.exitCode ?? app.signalCode}): ${logs}`);
    await pause(100);
  }
  throw new Error(`Timed out: ${description}\n${logs}`);
}
let nextId = 0;
const pending = new Map();
async function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function connect() {
  const page = await until(async () => {
    const pages = await (await fetch("http://127.0.0.1:9229/json/list")).json();
    return pages.find((page) => page.type === "page");
  }, "renderer debugging endpoint");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data),
      request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  await until(
    () => evaluate("Boolean(window.electron?.ipcRenderer && document.body.children.length)"),
    "preload and rendered window"
  );
}
function start(url) {
  app = spawn(executable, ["--remote-debugging-port=9229", `--user-data-dir=${profile}`, ...(url ? [url] : [])], {
    env,
  });
  app.on("error", (error) => {
    logs += error.message;
  });
  app.stdout.on("data", (data) => {
    logs += data;
  });
  app.stderr.on("data", (data) => {
    logs += data;
  });
}
async function stop() {
  socket?.close();
  socket = null;
  if (app && app.exitCode === null && app.signalCode === null) {
    const child = app;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
  app = null;
}
async function assertFixture(root, extracted = false) {
  assert.equal(await fs.readFile(path.join(root, "payload.txt"), "utf8"), "packaged archive extraction\n");
  assert.equal(await fs.readFile(path.join(root, "run.sh"), "utf8"), "#!/bin/sh\nexit 0\n");
  for (const [relative, mode] of [
    ["payload.txt", 0o640],
    ["run.sh", 0o751],
    ["restricted", 0o750],
    ["restricted/private.txt", 0o640],
  ]) {
    assert.equal((await fs.stat(path.join(root, relative))).mode & 0o777, mode, `Permission mismatch: ${relative}`);
  }
  if (extracted) assert.equal((await fs.stat(root)).mode & 0o777, 0o750);
}
async function assertUrlImport(name) {
  await assertFixture(path.join(library, name));
  const metadata = JSON.parse(await fs.readFile(path.join(library, name, "modinfo.json"), "utf8"));
  assert.equal(metadata.name, name);
  assert.equal(metadata.source, "https://gamebanana.com/mods/1");
  const mods = await evaluate('window.electron.ipcRenderer.invoke("load-library", true)');
  assert.ok(
    mods.some((mod) => mod.name === name && mod.source === metadata.source),
    `Imported ${name} must load from library`
  );
}
try {
  evidence.revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  evidence.sha256 = createHash("sha256")
    .update(await fs.readFile(executable))
    .digest("hex");
  work = await fs.mkdtemp(path.join(os.tmpdir(), "pmm-packaged-smoke-"));
  library = path.join(work, "library with spaces");
  profile = path.join(work, "profile");
  env = { ...process.env, XDG_CONFIG_HOME: path.join(work, "config"), XDG_DATA_HOME: path.join(work, "data") };
  await fs.mkdir(library, { recursive: true });
  await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await fs.mkdir(env.XDG_DATA_HOME, { recursive: true });
  const source = path.join(work, "source");
  await fs.mkdir(path.join(source, "路径 with spaces"), { recursive: true });
  await fs.writeFile(path.join(source, "路径 with spaces", "payload.txt"), "packaged archive extraction\n");
  const fixtureRoot = path.join(source, "路径 with spaces");
  await fs.chmod(fixtureRoot, 0o750);
  await fs.chmod(path.join(fixtureRoot, "payload.txt"), 0o640);
  await fs.writeFile(path.join(fixtureRoot, "run.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o751 });
  await fs.mkdir(path.join(fixtureRoot, "restricted"), { mode: 0o750 });
  await fs.writeFile(path.join(fixtureRoot, "restricted/private.txt"), "private fixture\n", { mode: 0o640 });
  const seven = path.join(packageRoot, "resources/app.asar.unpacked/node_modules/7zip-bin-full/linux/x64/7zz");
  await fs.access(seven, fs.constants.X_OK);
  for (const extension of ["zip", "7z", "tar"]) {
    execFileSync(seven, ["a", `-t${extension}`, path.join(work, `fixture.${extension}`), "."], { cwd: source });
  }
  execFileSync("python3", ["scripts/smoke/fixtures.py", path.join(work, "fixture.rar")]);
  for (const extension of ["zip", "7z", "tar", "rar"]) {
    const output = path.join(work, `extract-${extension}`);
    execFileSync(seven, ["x", path.join(work, `fixture.${extension}`), `-o${output}`, "-y"]);
    await assertFixture(path.join(output, "路径 with spaces"), true);
    evidence.checks.push(
      `bundled ${extension.toUpperCase()} extraction with Unicode/spaces, executable and restricted modes`
    );
  }
  start();
  await connect();
  const version = await evaluate('window.electron.ipcRenderer.invoke("get-app-version")');
  evidence.version = version;
  evidence.checks.push("packaged launch, preload IPC and rendered window");
  await evaluate(`window.electron.ipcRenderer.invoke("set-library-path", ${JSON.stringify(library)})`);
  const response = await evaluate(
    `window.electron.ipcRenderer.invoke("import-mod", ${JSON.stringify(path.join(work, "fixture.zip"))})`
  );
  assert.ok(response?.name, "real packaged import handler must return a mod");
  await assertFixture(path.join(library, response.name));
  evidence.checks.push("real packaged archive import into selected library");
  await stop();
  start();
  await connect();
  assert.equal(await evaluate('window.electron.ipcRenderer.invoke("get-library-path")'), library);
  const loaded = await evaluate('window.electron.ipcRenderer.invoke("load-library")');
  assert.ok(loaded.some((mod) => mod.name === response.name));
  evidence.checks.push("library selection and imported files survive process restart");
  server = http.createServer(async (_request, response) => {
    response.end(await fs.readFile(path.join(work, "fixture.zip")));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  function importUrl(name) {
    return `peakymodmanager://import?data=${encodeURIComponent(
      Buffer.from(
        JSON.stringify({
          modName: name,
          modSource: "https://gamebanana.com/mods/1",
          characterName: null,
          coverImageLink: "",
          downloadLinks: [{ filename: "fixture.zip", href: `http://127.0.0.1:${server.address().port}/fixture.zip` }],
        })
      ).toString("base64")
    )}`;
  }
  // Running-instance protocol handoff exercises the real packaged URL consumer.
  const child = spawn(executable, [`--user-data-dir=${profile}`, importUrl("RunningSmoke")], { env, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Second instance did not exit"));
    }, 15000);
    child.once("exit", () => clearTimeout(timer));
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Second instance exit ${code}`))));
    child.once("error", reject);
  });
  await until(async () => {
    await assertUrlImport("RunningSmoke");
    return true;
  }, "complete running-instance URL import");
  evidence.checks.push("running-instance URL download, extracted payload, permissions and loaded metadata");
  await stop();
  start(importUrl("ColdSmoke"));
  await connect();
  await until(async () => {
    await assertUrlImport("ColdSmoke");
    return true;
  }, "complete cold URL import");
  evidence.checks.push("cold argv URL download, extracted payload, permissions and loaded metadata");
  await stop();
  start();
  await connect();
  assert.equal(await evaluate('window.electron.ipcRenderer.invoke("get-library-path")'), library);
  for (const name of ["RunningSmoke", "ColdSmoke"]) await assertUrlImport(name);
  evidence.checks.push("both URL imports survive restart with complete payload and loaded metadata");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = error.stack;
  evidence.diagnostics =
    "Check packaged executable and bundled 7zz permissions, Xvfb/display, FUSE when mounting AppImage, and the specific packaged chrome-sandbox ownership/mode. Do not disable AppArmor or Chromium sandbox globally.";
  process.exitCode = 1;
} finally {
  await stop();
  server?.close();
  evidence.logs = logs;
  evidence.work = work;
  await fs.mkdir("smoke-results", { recursive: true });
  await fs.writeFile("smoke-results/linux-runtime.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.status === "passed" && work) await fs.rm(work, { recursive: true, force: true });
}
