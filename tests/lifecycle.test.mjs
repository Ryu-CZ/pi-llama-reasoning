import assert from "node:assert/strict";
import test from "node:test";
import extension from "../extensions/index.ts";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { model, props } from "./helpers/model.mjs";

function fixture(original = model()) {
  const handlers = new Map();
  const notifications = [];
  const replacements = [];
  let level = "medium";
  const ctx = {
    model: original,
    ui: { notify: (...args) => notifications.push(args) },
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test", headers: { "X-Test": "yes", removed: null } }) },
  };
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    getThinkingLevel: () => level,
    setThinkingLevel: (value) => { level = value; },
    setModel: async (next) => {
      replacements.push(next);
      ctx.model = next;
      level = "off";
      return true;
    },
  };
  extension(pi);
  return {
    ctx, notifications, replacements,
    get level() { return level; },
    emit: (name) => handlers.get(name)({}, ctx),
  };
}

function mockRouter(t, getProps = () => props) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).endsWith("/models")
      ? { data: [{ id: "qwen", status: { value: "loaded" } }] }
      : await getProps(init.signal));
  });
  return calls;
}

test("enhances the active model once, retaining its selected level and auth headers", async (t) => {
  const calls = mockRouter(t);
  const f = fixture();
  const original = f.ctx.model;
  await f.emit("session_start");
  assert.deepEqual(getSupportedThinkingLevels(f.ctx.model), ["off", "low", "medium", "xhigh"]);
  assert.equal(f.level, "medium");
  assert.equal(f.replacements.length, 1);
  assert.equal(original.compat.thinkingFormat, "qwen-chat-template");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer test");
  assert.equal(calls[0].init.headers.get("x-test"), "yes");
  assert.equal(calls[0].init.headers.has("removed"), false);
  await f.emit("before_agent_start");
  await f.emit("model_select");
  assert.equal(calls.length, 2);
  assert.equal(f.replacements.length, 1);
  assert.deepEqual(f.notifications, []);
});

test("respects explicit authorization header overrides, including removal", async (t) => {
  const calls = mockRouter(t);
  for (const value of ["Custom credential", null]) {
    const f = fixture();
    f.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({
      ok: true, apiKey: "unused", headers: { Authorization: value },
    });
    await f.emit("session_start");
    assert.equal(calls.at(-1).init.headers.get("authorization"), value);
  }
});

test("reapplies after /llama supplies a fresh model object", async (t) => {
  const calls = mockRouter(t);
  const f = fixture();
  await f.emit("session_start");
  f.ctx.model = model();
  await f.emit("before_agent_start");
  assert.equal(f.replacements.length, 2);
  assert.equal(calls.length, 4);
});

test("leaves other providers and explicit reasoning overrides alone, without network requests", async (t) => {
  const calls = mockRouter(t);
  for (const original of [model({ provider: "openai" }), model({ thinkingLevelMap: { low: "low" } }), undefined]) {
    const f = fixture(original);
    if (!original) f.ctx.model = undefined;
    await f.emit("session_start");
    assert.equal(f.replacements.length, 0);
  }
  assert.equal(calls.length, 0);
});

test("a model switch during discovery discards the stale result", async (t) => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  mockRouter(t, async () => { entered(); await waiting; return props; });
  const f = fixture();
  const pending = f.emit("session_start");
  await ready;
  f.ctx.model = model({ id: "other", provider: "openai" });
  release();
  await pending;
  assert.equal(f.replacements.length, 0);
});

test("shutdown aborts discovery without applying a model or reporting an error", async (t) => {
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  mockRouter(t, async (signal) => {
    entered();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const f = fixture();
  const pending = f.emit("session_start");
  await ready;
  await f.emit("session_shutdown");
  await pending;
  assert.equal(f.replacements.length, 0);
  assert.deepEqual(f.notifications, []);
});

test("the discovery timeout cancels the request and warns once per model", async (t) => {
  const timeouts = [];
  let timeoutController;
  t.mock.method(AbortSignal, "timeout", (duration) => {
    timeouts.push(duration);
    timeoutController = new AbortController();
    return timeoutController.signal;
  });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    timeoutController.abort();
    if (init.signal.aborted) throw init.signal.reason;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const f = fixture();
  const original = f.ctx.model;
  await f.emit("session_start");
  await f.emit("before_agent_start");
  assert.deepEqual(timeouts, [3000, 3000]);
  assert.equal(f.ctx.model, original);
  assert.equal(f.replacements.length, 0);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0][1], "warning");
});

test("discovery errors keep the original model and warn only once per model", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("secret server details"); });
  const f = fixture();
  const original = f.ctx.model;
  await f.emit("session_start");
  await f.emit("before_agent_start");
  assert.equal(f.ctx.model, original);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0][1], "warning");
  assert.doesNotMatch(f.notifications[0][0], /secret/);
});

test("missing capability reporting keeps the original model without warnings", async (t) => {
  mockRouter(t, () => ({}));
  const f = fixture();
  const original = f.ctx.model;
  await f.emit("session_start");
  assert.equal(f.ctx.model, original);
  assert.deepEqual(f.notifications, []);
});
