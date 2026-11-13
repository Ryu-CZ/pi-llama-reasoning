import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { discoverEfforts, withReasoningEfforts } from "../extensions/lib/reasoning.ts";

import { model, props } from "./helpers/model.mjs";

test("uses native efforts without inventing aliases or changing unrelated model fields", () => {
  const original = model({ samplingParams: { temperature: 0.6 }, input: ["text", "image"] });
  const snapshot = structuredClone(original);
  const next = withReasoningEfforts(original, props);
  assert.deepEqual(getSupportedThinkingLevels(next), ["off", "low", "medium", "xhigh"]);
  assert.equal(next.thinkingLevelMap.high, null);
  assert.equal(next.samplingParams, original.samplingParams);
  assert.equal(next.input, original.input);
  assert.equal(next.maxTokens, original.maxTokens);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(next.compat.chatTemplateKwargs, {
    enable_thinking: { $var: "thinking.enabled" },
    preserve_thinking: true,
    reasoning_effort: { $var: "thinking.effort", omitWhenOff: true },
  });
});

test("effort-only templates do not acquire an off switch", () => {
  const next = withReasoningEfforts(model({ thinkingLevelMap: undefined, compat: {} }), props);
  assert.deepEqual(getSupportedThinkingLevels(next), ["low", "medium", "xhigh"]);
  assert.equal(next.compat.chatTemplateKwargs.enable_thinking, undefined);
});

test("preserves independent token-budget and per-level sampling configuration", () => {
  const original = model({
    compat: { ...model().compat, thinkingTokenBudgetField: "thinking_budget_tokens" },
    samplingParamsByThinkingLevel: { medium: { thinking_budget_tokens: 4096 } },
  });
  const next = withReasoningEfforts(original, props);
  assert.equal(next.compat.thinkingTokenBudgetField, "thinking_budget_tokens");
  assert.equal(next.samplingParamsByThinkingLevel, original.samplingParamsByThinkingLevel);
});

test("leaves explicit reasoning configuration and other providers untouched", () => {
  for (const original of [
    model({ provider: "other" }),
    model({ reasoning: false }),
    model({ api: "anthropic-messages" }),
    model({ thinkingLevelMap: { low: "low", high: "high" } }),
    model({ compat: { thinkingFormat: "openai" } }),
    model({ compat: { ...model().compat, supportsReasoningEffort: true } }),
    model({ compat: { ...model().compat, chatTemplateKwargs: { preserve_thinking: false } } }),
  ]) assert.equal(withReasoningEfforts(original, props), undefined);
});

test("missing, malformed, unsupported or custom effort reports fall back unchanged", () => {
  for (const value of [
    undefined, null, [], {},
    { chat_template_caps: { supports_reasoning_effort: false, reasoning_effort_levels: ["low"] } },
    ...[null, "low", [], ["custom"], ["low", "custom"], [null]].map((levels) => ({
      chat_template_caps: { supports_reasoning_effort: true, reasoning_effort_levels: levels },
    })),
  ]) assert.equal(withReasoningEfforts(model(), value), undefined);
});

test("checks router status before requesting model props and preserves URL prefix/auth", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1
      ? { data: [{ id: "a/b + c", status: { value: "loaded" } }] }
      : props);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await discoverEfforts("http://localhost:8080/proxy/v1/", "a/b + c", { Authorization: "Bearer test" }, signal), props);
  assert.equal(calls[0].url, "http://localhost:8080/proxy/models");
  const url = new URL(calls[1].url);
  assert.equal(url.pathname, "/proxy/props");
  assert.equal(url.searchParams.get("model"), "a/b + c");
  assert.equal(calls[1].init.signal, signal);
  assert.deepEqual(calls[1].init.headers, { Authorization: "Bearer test" });
  assert.equal(calls[1].init.redirect, "error");
});

for (const status of ["sleeping", "unloaded", "loading", "failed", undefined]) {
  test(`does not query props for ${status} models`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ data: [{ id: "qwen", status: { value: status } }] });
    });
    assert.equal(await discoverEfforts(model().baseUrl, "qwen", {}, new AbortController().signal), undefined);
    assert.equal(calls, 1);
  });
}

test("HTTP errors are rejected without including credentials or response bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("secret", { status: 401 }));
  await assert.rejects(discoverEfforts(model().baseUrl, "qwen", {}, new AbortController().signal), {
    message: "llama.cpp discovery returned HTTP 401",
  });
});
