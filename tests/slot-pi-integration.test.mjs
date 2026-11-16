import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const piEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", piEntry));
const { createLlamaProvider } = await import(new URL("./extensions/llama/provider.js", piEntry));

test("real Pi sessions forward distinct stable slot IDs through the built-in provider", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-slot-integration-"));
  const oldCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = dir;
  const sessions = [];
  const errors = [];
  t.after(async () => {
    for (const session of sessions) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (oldCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = oldCache;
    await rm(dir, { recursive: true, force: true });
    assert.deepEqual(errors, [], "including extension shutdown errors");
  });
  const requests = [];
  let totalSlots = 2;
  const catalog = { data: [{ id: "qwen", status: { value: "loaded" }, meta: { n_ctx: 8192 } }] };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, "Bearer test-key");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/models") res.end(JSON.stringify(catalog));
    else if (req.url.startsWith("/props")) res.end(JSON.stringify({ total_slots: totalSlots, endpoint_slots: true }));
    else if (req.url.startsWith("/slots")) res.end(JSON.stringify(Array.from({ length: totalSlots }, (_, id) => ({ id, is_processing: false }))));
    else if (req.url === "/v1/chat/completions") {
      requests.push(JSON.parse(body));
      res.setHeader("Content-Type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "qwen",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    } else { res.writeHead(404); res.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${server.address().port}`;

  async function start() {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("llama.cpp", async () => ({ type: "api_key", key: "test-key", env: { LLAMA_BASE_URL: root } }));
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null,
      modelsStorePath: join(dir, "models.json"), refreshOnCreate: false });
    runtime.registerNativeProvider(createLlamaProvider().provider);
    assert.equal((await runtime.refresh({ providers: ["llama.cpp"], allowNetwork: true })).errors.size, 0);
    const loaded = await loadExtensions([join(process.cwd(), "extensions/index.ts")], dir, createEventBus());
    assert.deepEqual(loaded.errors, []);
    const resourceLoader = {
      getExtensions: () => loaded, getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => "Reply OK.",
      getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
      extendResources() {}, async reload() {},
    };
    const { session } = await createAgentSession({ cwd: dir, agentDir: dir, model: runtime.getModel("llama.cpp", "qwen"),
      modelRuntime: runtime, resourceLoader, noTools: true, sessionManager: SessionManager.inMemory(dir),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
    await session.bindExtensions({ onError: (error) => errors.push(error) });
    sessions.push(session);
    return session;
  }

  const a = await start();
  const b = await start();
  for (const session of [a, b, a, b]) {
    await session.prompt("Hello");
    assert.equal(session.getLastAssistantText(), "OK");
  }
  assert.deepEqual(requests.map((r) => r.id_slot), [0, 1, 0, 1]);
  assert.ok(requests.every((r) => r.cache_prompt === true));

  // A changed server slot count is rediscovered rather than reusing an invalid ID.
  totalSlots = 1;
  await b.prompt("After a server change");
  assert.equal(requests.at(-1).id_slot, undefined);
  await a.prompt("Still valid");
  assert.equal(requests.at(-1).id_slot, 0);

  // Explicit serializer values survive the actual extension hook, including cache disable.
  await a.setModel({ ...a.model, samplingParamsByThinkingLevel: { off: { id_slot: 0, cache_prompt: false } } });
  a.setThinkingLevel("off");
  await a.prompt("Explicit settings");
  assert.equal(requests.at(-1).id_slot, 0);
  assert.equal(requests.at(-1).cache_prompt, false);
  assert.deepEqual(errors, []);
});
