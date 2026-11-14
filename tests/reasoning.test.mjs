import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { withReasoningEfforts } from "../extensions/lib/reasoning.ts";
import { model, props } from "./helpers/model.mjs";

test("uses native efforts without inventing aliases or changing unrelated model fields", () => {
  const original = model({ samplingParams: { temperature: 0.6 }, input: ["text", "image"] });
  const snapshot = structuredClone(original);
  const next = withReasoningEfforts(original, props);
  assert.deepEqual(getSupportedThinkingLevels(next), ["off", "low", "medium", "xhigh"]);
  assert.equal(next.thinkingLevelMap.high, null);
  assert.equal(withReasoningEfforts(next, props), undefined, "enhanced models are no longer automatic candidates");
  assert.equal(next.samplingParams, original.samplingParams);
  assert.equal(next.input, original.input);
  assert.equal(next.maxTokens, original.maxTokens);
  assert.equal(next.compat.thinkingTokenBudgetField, "thinking_budget_tokens");
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

test("preserves explicit token-budget fields, legacy flags and per-level sampling configuration", () => {
  for (const budgetCompat of [
    { thinkingTokenBudgetField: "thinking_budget_tokens" },
    { thinkingTokenBudgetField: "thinking_budget" },
    { thinkingTokenBudgetField: "thinking_token_budget" },
    { supportsThinkingTokenBudget: true },
    { supportsThinkingTokenBudget: false },
  ]) {
    const original = model({
      compat: { ...model().compat, ...budgetCompat },
      samplingParamsByThinkingLevel: { medium: { thinking_budget_tokens: 4096 } },
    });
    const next = withReasoningEfforts(original, props);
    assert.equal(next.compat.thinkingTokenBudgetField, budgetCompat.thinkingTokenBudgetField);
    assert.equal(next.compat.supportsThinkingTokenBudget, budgetCompat.supportsThinkingTokenBudget);
    assert.equal(next.samplingParamsByThinkingLevel, original.samplingParamsByThinkingLevel);
  }
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
