import assert from "node:assert/strict";
import test from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { registerSlotPinning } from "../extensions/lib/slots.ts";
import { model } from "./helpers/model.mjs";

function fixture() {
  const events = createEventBus();
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  const statuses = [];
  const claims = [];
  const leases = {
    assigned: 0, released: 0, closed: false,
    acquire(...args) { claims.push(args); return this.assigned; },
    list: () => [{ slotId: 0, sessionId: "session-a", pid: process.pid }],
    release() { this.released++; },
    close() { this.closed = true; },
  };
  const ctx = {
    model: model(),
    isIdle: () => true,
    sessionManager: { getSessionId: () => "session-a" },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "secret" }) },
    ui: { notify: (...args) => notifications.push(args), setStatus: (...args) => statuses.push(args) },
  };
  registerSlotPinning({ events, on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command) }, leases);
  return { ctx, leases, claims, notifications, statuses, events,
    setEnabled: (enabled) => {
      let result;
      events.emit("pi-llama-reasoning:set-slot-management", { enabled, reply: (value) => { result = value; } });
      return result;
    },
    emit: (event, payload) => handlers.get(event)({ payload }, ctx),
    inspect: () => commands.get("llama-slots").handler("", ctx) };
}

function router(t, options = {}) {
  const calls = [];
  const slots = options.slots ?? [{ id: 0, is_processing: false, n_ctx: 8192, n_prompt_tokens: 23,
    n_prompt_tokens_processed: 0, n_prompt_tokens_cache: 0 }, { id: 1, is_processing: true }];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: new URL(url), init });
    const path = new URL(url).pathname;
    if (path.endsWith("/models")) return Response.json({ data: [{ id: "qwen", status: { value: options.state ?? "loaded" } }] });
    if (path.endsWith("/props")) return Response.json(options.props ?? { total_slots: 2, endpoint_slots: true });
    if (options.failSlots) throw new Error("secret endpoint details");
    return Response.json(slots);
  });
  return calls;
}

const payload = () => ({ model: "qwen", messages: [{ role: "user", content: "hello" }], temperature: 0.3 });

test("slot management can be disabled before startup and re-enabled while idle", async (t) => {
  const calls = router(t);
  const f = fixture();
  assert.deepEqual(f.setEnabled(false), { ok: true, enabled: false });
  await f.emit("session_start");
  const request = { ...payload(), id_slot: 1 };
  assert.equal(await f.emit("before_provider_request", request), undefined);
  assert.equal(request.cache_prompt, undefined);
  assert.equal(calls.length, 0);
  assert.equal(f.claims.length, 0);
  await f.inspect();
  assert.match(f.notifications[0][0], /Slot 0: idle/);
  assert.deepEqual(f.setEnabled(true), { ok: true, enabled: true });
  assert.equal((await f.emit("before_provider_request", payload())).id_slot, 0);
  const released = f.leases.released;
  assert.deepEqual(f.setEnabled(false), { ok: true, enabled: false });
  assert.equal(f.leases.released, released + 1);
  assert.deepEqual(f.statuses.at(-1), ["llama-slots", undefined]);
  assert.deepEqual(f.setEnabled(false), { ok: true, enabled: false });
  assert.equal(f.leases.released, released + 1);
});

test("slot management rejects busy changes, invalid input and failed lease cleanup", async (t) => {
  router(t);
  const f = fixture();
  await f.emit("session_start");
  await f.emit("before_provider_request", payload());
  f.ctx.isIdle = () => false;
  assert.deepEqual(f.setEnabled(false), { ok: false, enabled: true, reason: "busy" });
  assert.equal(f.leases.released, 0);
  assert.deepEqual(f.setEnabled(true), { ok: true, enabled: true });
  f.ctx.isIdle = () => true;
  for (const value of [undefined, null, "false", 0]) {
    assert.deepEqual(f.setEnabled(value), { ok: false, enabled: true, reason: "invalid-request" });
  }
  f.leases.release = () => { throw new Error("secret database path"); };
  assert.deepEqual(f.setEnabled(false), { ok: false, enabled: true, reason: "cleanup-failed" });
  assert.equal((await f.emit("before_provider_request", payload())).id_slot, 0);
});

test("slot management rejects handoff during discovery and unsubscribes on shutdown", async (t) => {
  let ready;
  const started = new Promise((resolve) => { ready = resolve; });
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  t.mock.method(globalThis, "fetch", async () => { ready(); await waiting; return Response.json({}); });
  const f = fixture();
  await f.emit("session_start");
  const pending = f.emit("before_provider_request", payload());
  await started;
  assert.deepEqual(f.setEnabled(false), { ok: false, enabled: true, reason: "busy" });
  finish();
  await pending;
  assert.deepEqual(f.setEnabled(false), { ok: true, enabled: false });
  await f.emit("session_shutdown");
  assert.equal(f.setEnabled(true), undefined);
  assert.deepEqual(fixture().setEnabled(true), { ok: true, enabled: true });
});

test("automatically pins a supported model without changing other payload fields", async (t) => {
  const calls = router(t);
  const f = fixture();
  const original = payload();
  const result = await f.emit("before_provider_request", original);
  assert.deepEqual(result, { ...original, id_slot: 0, cache_prompt: true });
  assert.equal(original.id_slot, undefined);
  assert.deepEqual(f.claims[0].slice(1), ["session-a", [0, 1], [1], undefined]);
  assert.equal(f.claims[0][0].length, 64);
  assert.equal(calls.length, 3);
  for (const { url, init } of calls) {
    assert.equal(init.headers.get("authorization"), "Bearer secret");
    if (!url.pathname.endsWith("models")) assert.equal(url.searchParams.get("model"), "qwen");
  }
  assert.deepEqual(f.notifications, []);
});

test("pinning is independent of reasoning capabilities and supports a single slot", async (t) => {
  router(t, { props: { total_slots: 1, endpoint_slots: true }, slots: [{ id: 0, is_processing: false }] });
  const f = fixture();
  f.ctx.model.reasoning = false;
  assert.equal((await f.emit("before_provider_request", payload())).id_slot, 0);
});

test("preserves explicit slot and cache settings", async (t) => {
  router(t);
  const f = fixture();
  f.leases.assigned = 1;
  const request = { ...payload(), id_slot: 1, cache_prompt: false };
  assert.deepEqual(await f.emit("before_provider_request", request), request);
  assert.equal(f.claims[0].at(-1), 1);
  assert.match(f.statuses.at(-1)[1], /cache disabled/);
});

test("coordinates modulo-wrapped explicit IDs without rewriting them or explicit null cache settings", async (t) => {
  router(t);
  const f = fixture();
  f.leases.assigned = 1;
  const request = { ...payload(), id_slot: 5, cache_prompt: null };
  assert.deepEqual(await f.emit("before_provider_request", request), request);
  assert.equal(f.claims[0].at(-1), 1);
});

test("preserves server-auto and malformed explicit slot values without allocation", async (t) => {
  router(t);
  for (const id_slot of [-1, null, "1", 1.5]) {
    const f = fixture();
    assert.equal(await f.emit("before_provider_request", { ...payload(), id_slot }), undefined);
    assert.equal(f.claims.length, 0);
  }
});

test("unavailable, disabled, malformed and unloaded discovery leaves requests unchanged", async (t) => {
  for (const options of [{ state: "sleeping" }, { state: "unloaded" }, { props: {} },
    { props: { total_slots: 2, endpoint_slots: false } }, { slots: [] },
    { slots: [{ id: 0, is_processing: false }, { id: 0, is_processing: false }] },
    { slots: [{ id: 0 }, { id: 1, is_processing: false }] },
    { slots: [{ id: 2, is_processing: false }, { id: 3, is_processing: false }] }]) {
    const calls = router(t, options);
    const f = fixture();
    assert.equal(await f.emit("before_provider_request", payload()), undefined);
    assert.equal(f.claims.length, 0);
    assert.match(f.notifications.at(-1)[0], /unavailable/);
    if (options.state) assert.equal(calls.length, 1);
    t.mock.restoreAll();
  }
});

test("does not touch other providers, model payloads, or non-chat requests", async (t) => {
  const calls = router(t);
  const f = fixture();
  for (const request of [{ ...payload(), model: "other" }, { model: "qwen", prompt: "hello" }, null]) {
    assert.equal(await f.emit("before_provider_request", request), undefined);
  }
  f.ctx.model.provider = "openai";
  assert.equal(await f.emit("before_provider_request", payload()), undefined);
  assert.equal(calls.length, 0);
});

test("exhaustion and explicit conflicts warn without replacing the request", async (t) => {
  router(t);
  const f = fixture();
  f.leases.assigned = undefined;
  for (let i = 0; i < 2; i++) assert.equal(await f.emit("before_provider_request", payload()), undefined);
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0][0], /all busy or leased; unpinned/);
  assert.equal(await f.emit("before_provider_request", { ...payload(), id_slot: 1 }), undefined);
  assert.match(f.notifications.at(-1)[0], /explicit slot unavailable/);
});

test("discovery errors fail open with a sanitized warning", async (t) => {
  router(t, { failSlots: true });
  const f = fixture();
  assert.equal(await f.emit("before_provider_request", payload()), undefined);
  assert.deepEqual(f.notifications, [[
    "llama slots: discovery or coordination failed; request unchanged", "warning",
  ]]);
});

test("coordination errors fail open with a sanitized warning", async (t) => {
  router(t);
  const f = fixture();
  f.leases.acquire = () => { throw new Error("secret database path"); };
  assert.equal(await f.emit("before_provider_request", payload()), undefined);
  assert.deepEqual(f.notifications, [[
    "llama slots: discovery or coordination failed; request unchanged", "warning",
  ]]);
});

test("model changes and shutdown discard in-flight results and release leases", async (t) => {
  let ready;
  const started = new Promise((resolve) => { ready = resolve; });
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  t.mock.method(globalThis, "fetch", async () => { ready(); await waiting; return Response.json({}); });
  const f = fixture();
  const pending = f.emit("before_provider_request", payload());
  await started;
  f.ctx.model = model({ id: "other" });
  await f.emit("model_select");
  await f.emit("session_shutdown");
  finish();
  assert.equal(await pending, undefined);
  assert.equal(f.claims.length, 0);
  assert.equal(f.leases.closed, true);
  assert.equal(f.leases.released, 2);
});

test("the discovery deadline also bounds credential lookup", async (t) => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 3000); return deadline.signal; });
  const f = fixture();
  f.ctx.modelRegistry.getApiKeyAndHeaders = () => {
    queueMicrotask(() => deadline.abort(new Error("secret credential timeout")));
    return new Promise(() => {});
  };
  assert.equal(await f.emit("before_provider_request", payload()), undefined);
  assert.match(f.notifications[0][0], /failed; request unchanged/);
  assert.equal(f.claims.length, 0);
});

test("shutdown still closes coordination after a release failure", async () => {
  const f = fixture();
  f.leases.release = () => { throw new Error("secret db path"); };
  await f.emit("session_shutdown");
  assert.equal(f.leases.closed, true);
  assert.match(f.notifications[0][0], /cleanup failed/);
  assert.doesNotMatch(f.notifications[0][0], /secret/);
});

test("inspection reports fresh server state and local leases without acquiring", async (t) => {
  router(t);
  const f = fixture();
  await f.inspect();
  assert.equal(f.claims.length, 0);
  assert.equal(f.leases.released, 0);
  assert.match(f.notifications[0][0], /Slot 0: idle; context 8192; prompt 23; processed 0; cached 0; this session/);
  assert.match(f.notifications[0][0], /Slot 1: busy; context \?/);
  assert.match(f.notifications[0][0], /not total KV memory/);
});
