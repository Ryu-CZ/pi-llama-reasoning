import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SlotLeases } from "../extensions/lib/slot-leases.ts";

const moduleUrl = new URL("../extensions/lib/slot-leases.ts", import.meta.url).href;
const workerSource = `
  import { SlotLeases } from ${JSON.stringify(moduleUrl)};
  const leases = new SlotLeases(process.argv[1]);
  process.on("message", ({ method, args }) => {
    try {
      process.send({ result: leases[method](...args) ?? null });
    } catch (error) {
      process.send({ error: error.stack });
    }
  });
  process.send({ ready: true });
`;

const cleanups = new WeakMap();

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "pi-slot-leases-"));
  const callbacks = [];
  cleanups.set(t, callbacks);
  t.after(async () => {
    try {
      for (const cleanup of callbacks.reverse()) await cleanup();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return join(directory, "private", "slots.sqlite");
}

function manager(t, path) {
  const leases = new SlotLeases(path);
  cleanups.get(t).push(() => leases.close());
  return leases;
}

async function worker(t, path, source = workerSource) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, path], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  cleanups.get(t).push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  });
  const ready = await Promise.race([
    once(child, "message").then(([message]) => message),
    once(child, "exit").then(() => { throw new Error(`Worker exited: ${stderr}`); }),
  ]);
  assert.equal(ready.ready, true);
  return {
    pid: child.pid,
    async call(method, ...args) {
      const response = once(child, "message");
      child.send({ method, args });
      const [message] = await response;
      assert.equal(message.error, undefined, message.error);
      return message.result ?? undefined;
    },
    async crash() {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    },
  };
}

test("construction, release and close do not open SQLite or create files", (t) => {
  const path = fixture(t);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { SlotLeases } from ${JSON.stringify(moduleUrl)};
    const leases = new SlotLeases(${JSON.stringify(path)});
    leases.release();
    leases.close();
    leases.close();
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(path), false);
});

test("default database respects XDG_CACHE_HOME and creates private directory and file", (t) => {
  const path = fixture(t);
  const cache = join(path, "cache");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { SlotLeases } from ${JSON.stringify(moduleUrl)};
    const leases = new SlotLeases();
    leases.list("opaque-scope");
    leases.close();
  `], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: cache } });
  assert.equal(result.status, 0, result.stderr);
  const directory = join(cache, "pi-llama-reasoning");
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, "slots.sqlite")).mode & 0o777, 0o600);
});

test("independent processes race for distinct slots, exhaust capacity and retain busy ownership", { timeout: 15000 }, async (t) => {
  const path = fixture(t);
  const workers = await Promise.all(Array.from({ length: 5 }, () => worker(t, path)));
  const assignments = await Promise.all(workers.map((child) => child.call("acquire", "scope", "same-session", [0, 1, 2], [])));
  assert.deepEqual(assignments.filter((slot) => slot !== undefined).sort(), [0, 1, 2]);
  assert.equal(assignments.filter((slot) => slot === undefined).length, 2);
  const observer = manager(t, path);
  const rows = observer.list("scope");
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.pid)).size, 3);
  for (const [index, slot] of assignments.entries()) {
    if (slot === undefined) continue;
    assert.equal(await workers[index].call("acquire", "scope", "same-session", [0, 1, 2], [0, 1, 2]), slot);
    assert.deepEqual(rows.find((row) => row.slotId === slot), { slotId: slot, sessionId: "same-session", pid: workers[index].pid });
  }
  const ownerIndex = assignments.findIndex((slot) => slot !== undefined);
  const waitingIndex = assignments.findIndex((slot) => slot === undefined);
  await workers[ownerIndex].call("release");
  assert.equal(await workers[waitingIndex].call("acquire", "scope", "same-session", [0, 1, 2], []), assignments[ownerIndex]);
});

test("instances in one process have independent ownership even for the same session", (t) => {
  const path = fixture(t);
  const first = manager(t, path);
  const second = manager(t, path);
  assert.equal(first.acquire("scope", "session", [0, 1], []), 0);
  assert.equal(first.acquire("scope", "session", [1, 0], []), 0);
  assert.equal(second.acquire("scope", "session", [0, 1], []), 1);
  first.release();
  first.release();
  assert.deepEqual(second.list("scope"), [{ slotId: 1, sessionId: "session", pid: process.pid }]);
  second.close();
  second.close();
  assert.deepEqual(first.list("scope"), []);
});

test("explicit slots conflict across processes and never fall back to another slot", { timeout: 15000 }, async (t) => {
  const path = fixture(t);
  const first = await worker(t, path);
  const second = await worker(t, path);
  assert.equal(await first.call("acquire", "scope", "first", [0, 1], [], 1), 1);
  assert.equal(await second.call("acquire", "scope", "second", [0, 1], [], 1), undefined);
  assert.equal(await first.call("acquire", "scope", "first", [0, 1], [1], 1), 1);
  await first.call("close");
  assert.equal(await second.call("acquire", "scope", "second", [0, 1], [], 1), 1);
});

test("busy slots, single-slot servers, invalid explicit slots and empty capacity", (t) => {
  const leases = manager(t, fixture(t));
  assert.equal(leases.acquire("scope", "session", [0], [0]), undefined);
  assert.equal(leases.acquire("scope", "session", [0], [], 1), undefined);
  assert.equal(leases.acquire("scope", "session", [0], []), 0);
  assert.equal(leases.acquire("scope", "session", [0], [0]), 0);
  assert.equal(leases.acquire("scope", "session", [], []), undefined);
  assert.deepEqual(leases.list("scope"), []);
  assert.equal(leases.acquire("scope", "session", [0, 1], [0]), 1);
  assert.equal(leases.acquire("scope", "session", [0, 1], [0], 0), undefined);
});

test("scope and session changes release all previous ownership, even when allocation fails", (t) => {
  const leases = manager(t, fixture(t));
  assert.equal(leases.acquire("first-scope", "first-session", [0], []), 0);
  assert.equal(leases.acquire("second-scope", "first-session", [0], []), 0);
  assert.deepEqual(leases.list("first-scope"), []);
  assert.equal(leases.acquire("second-scope", "second-session", [0, 1], [0]), 1);
  assert.deepEqual(leases.list("second-scope"), [{ slotId: 1, sessionId: "second-session", pid: process.pid }]);
  assert.equal(leases.acquire("third-scope", "third-session", [], []), undefined);
  assert.deepEqual(leases.list("second-scope"), []);
});

test("list omits dead leases without mutating them; acquire reclaims after a crash", { timeout: 15000 }, async (t) => {
  const path = fixture(t);
  const owner = await worker(t, path);
  assert.equal(await owner.call("acquire", "scope", "crashed", [0], []), 0);
  const leases = manager(t, path);
  assert.equal(leases.acquire("scope", "waiting", [0], []), undefined);
  await owner.crash();
  assert.deepEqual(leases.list("scope"), []);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  cleanups.get(t).push(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM leases").get().count, 1);
  assert.equal(leases.acquire("scope", "waiting", [0], []), 0);
  assert.deepEqual(leases.list("scope"), [{ slotId: 0, sessionId: "waiting", pid: process.pid }]);
});

test("EPERM is treated as alive, not reclaimable", (t) => {
  const path = fixture(t);
  const owner = manager(t, path);
  const contender = manager(t, path);
  assert.equal(owner.acquire("scope", "owner", [0], []), 0);
  const kill = process.kill;
  process.kill = () => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); };
  try {
    assert.equal(contender.list("scope").length, 1);
    assert.equal(contender.acquire("scope", "contender", [0], []), undefined);
  } finally {
    process.kill = kill;
  }
});

test("write contention fails within one second and recovers after unlocking", { timeout: 15000 }, async (t) => {
  const path = fixture(t);
  const leases = manager(t, path);
  const unopened = manager(t, path);
  assert.equal(leases.acquire("scope", "original", [0, 1], []), 0);
  const locker = await worker(t, path, `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    db.exec("BEGIN IMMEDIATE");
    process.on("message", () => {
      db.exec("ROLLBACK");
      db.close();
      process.send({ result: null });
    });
    process.send({ ready: true });
  `);

  for (const [name, operation] of [
    ["acquire", () => leases.acquire("scope", "changed", [0, 1], [])],
    ["lazy acquire", () => unopened.acquire("scope", "new", [0, 1], [])],
    ["release", () => leases.release()],
  ]) {
    const started = performance.now();
    assert.throws(operation, /database is locked/);
    const elapsed = performance.now() - started;
    t.diagnostic(`${name} contention: ${Math.round(elapsed)} ms`);
    assert.ok(elapsed < 1000, `${name} blocked for ${Math.round(elapsed)} ms`);
  }
  assert.deepEqual(leases.list("scope"), [{ slotId: 0, sessionId: "original", pid: process.pid }]);
  await locker.call("unlock");
  assert.equal(leases.acquire("scope", "original", [0, 1], []), 0);
  assert.equal(unopened.acquire("scope", "new", [0, 1], []), 1);
  leases.release();
  assert.deepEqual(unopened.list("scope"), [{ slotId: 1, sessionId: "new", pid: process.pid }]);
});

test("failed writes roll back ownership changes and leave the connection usable", async (t) => {
  const path = fixture(t);
  const leases = manager(t, path);
  assert.equal(leases.acquire("scope", "original", [0], []), 0);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  cleanups.get(t).push(() => db.close());
  db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON leases BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => leases.acquire("other", "changed", [0], []), /test failure/);
  assert.deepEqual(leases.list("scope"), [{ slotId: 0, sessionId: "original", pid: process.pid }]);
  db.exec("DROP TRIGGER fail_insert");
  assert.equal(leases.acquire("other", "changed", [0], []), 0);
  assert.deepEqual(leases.list("scope"), []);
});
