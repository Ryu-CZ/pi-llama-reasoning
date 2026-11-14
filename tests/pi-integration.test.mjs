import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession, createEventBus, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { props } from "./helpers/model.mjs";

// Use Pi's actual loader and built-in provider, not reimplementations in the fixture.
const piEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", piEntry));
const { createLlamaProvider } = await import(new URL("./extensions/llama/provider.js", piEntry));

test("Pi loader, built-in provider, thinking selector and serializer work together", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-llama-reasoning-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const requests = [];
  let serverProps = props;
  const catalog = { data: [{
    id: "qwen", status: { value: "loaded" }, meta: { n_ctx: 32768 },
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  }] };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
    if (req.url === "/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(catalog));
    } else if (req.url.startsWith("/props")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ...serverProps, chat_template: "{% if enable_thinking %}think{% endif %}" }));
    } else if (req.url === "/v1/chat/completions") {
      res.setHeader("Content-Type", "text/event-stream");
      res.end(`data: ${JSON.stringify({
        id: "test", object: "chat.completion.chunk", created: 1, model: "qwen",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      })}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const root = `http://127.0.0.1:${server.address().port}`;
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("llama.cpp", async () => ({
    type: "api_key", key: "fixture-key", env: { LLAMA_BASE_URL: root },
  }));
  const runtime = await ModelRuntime.create({
    credentials, modelsPath: null, modelsStorePath: join(dir, "models-cache.json"), refreshOnCreate: false,
  });
  const { provider } = createLlamaProvider();
  runtime.registerNativeProvider(provider);
  const refresh = await runtime.refresh({ providers: ["llama.cpp"], allowNetwork: true });
  assert.equal(refresh.errors.size, 0);
  const original = runtime.getModel("llama.cpp", "qwen");
  assert.ok(original);
  const providerBefore = runtime.getProvider("llama.cpp");
  const classifierBefore = runtime.getModelOfType("classifier", "llama.cpp", "qwen");
  let loaded = await loadExtensions([join(process.cwd(), "extensions/index.ts")], dir, createEventBus());
  assert.deepEqual(loaded.errors, []);
  const resourceLoader = {
    getExtensions: () => loaded,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Say hello.", getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources() {},
    async reload() {
      loaded = await loadExtensions([
        new URL("./extensions/llama/index.js", piEntry).pathname,
        join(process.cwd(), "extensions/index.ts"),
      ], dir, createEventBus());
      assert.deepEqual(loaded.errors, []);
    },
  };
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, model: original, thinkingLevel: "medium", modelRuntime: runtime,
    resourceLoader, noTools: true, sessionManager: SessionManager.inMemory(dir),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  });
  t.after(() => session.dispose());
  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  assert.deepEqual(errors, []);
  assert.deepEqual(session.getAvailableThinkingLevels(), ["off", "low", "medium", "xhigh"]);
  assert.equal(runtime.getProvider("llama.cpp"), providerBefore);
  assert.equal(runtime.getModel("llama.cpp", "qwen"), original);
  assert.equal(runtime.getModelOfType("classifier", "llama.cpp", "qwen"), classifierBefore);

  for (const level of ["low", "medium", "xhigh", "off"]) {
    session.setThinkingLevel(level);
    await session.prompt("Hello.");
    assert.equal(session.getLastAssistantText(), "Hello.");
    const payload = requests.filter((request) => request.body).at(-1).body;
    assert.equal(payload.chat_template_kwargs.enable_thinking, level !== "off");
    assert.equal(payload.chat_template_kwargs.reasoning_effort, level === "off" ? undefined : level);
    assert.equal(payload.chat_template_kwargs.preserve_thinking, true);
    const budgets = { low: 2048, medium: 8192, xhigh: 16384 };
    assert.equal(payload.thinking_budget_tokens, budgets[level]);
  }

  session.agent.thinkingBudgets = { low: 1024, medium: 4096, high: 12288 };
  for (const [level, budget] of [["low", 1024], ["medium", 4096], ["xhigh", 12288]]) {
    session.setThinkingLevel(level);
    await session.prompt("Hello with a custom budget.");
    const payload = requests.filter((request) => request.body).at(-1).body;
    assert.equal(payload.chat_template_kwargs.reasoning_effort, level);
    assert.equal(payload.thinking_budget_tokens, budget);
  }
  session.agent.thinkingBudgets = undefined;

  const enhanced = session.model;
  await session.setModel({ ...enhanced, maxTokens: 4096 });
  session.setThinkingLevel("xhigh");
  await session.prompt("Hello with limited output room.");
  const clamped = requests.filter((request) => request.body).at(-1).body;
  assert.equal(clamped.max_tokens, 4096);
  assert.equal(clamped.thinking_budget_tokens, 3072);

  await session.setModel(original);
  await session.prompt("Hello after a catalog replacement.");
  assert.deepEqual(session.getAvailableThinkingLevels(), ["off", "low", "medium", "xhigh"]);

  await t.test("reload retains enhanced metadata instead of rediscovering changed capabilities", async () => {
    serverProps = { chat_template_caps: { supports_reasoning_effort: true, reasoning_effort_levels: ["low"] } };
    const before = requests.length;
    await session.reload();
    assert.equal(requests.length, before, "reload does not query the router");
    assert.deepEqual(session.getAvailableThinkingLevels(), ["off", "low", "medium", "xhigh"]);
    serverProps = props;
  });

  await session.setModel({
    ...session.model,
    samplingParamsByThinkingLevel: { medium: { thinking_budget_tokens: 4096 } },
  });
  session.setThinkingLevel("medium");
  await session.prompt("Hello with a budget.");
  const budgeted = requests.filter((request) => request.body).at(-1).body;
  assert.equal(budgeted.chat_template_kwargs.reasoning_effort, "medium");
  assert.equal(budgeted.thinking_budget_tokens, 4096);

  assert.ok(requests.every((request) => request.headers.authorization === "Bearer fixture-key"));
  assert.deepEqual(errors, []);
});
