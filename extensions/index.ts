import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverEfforts, isAutomaticCandidate, withReasoningEfforts } from "./lib/reasoning.ts";

export default function (pi: ExtensionAPI) {
  const enhanced = new WeakSet<Model<Api>>();
  const warned = new Set<string>();
  let pending: AbortController | undefined;

  async function update(ctx: ExtensionContext) {
    pending?.abort();
    const model = ctx.model;
    if (!model || enhanced.has(model) || !isAutomaticCandidate(model)) return;

    const controller = new AbortController();
    pending = controller;
    const signals = [controller.signal, AbortSignal.timeout(3000)];
    if (ctx.signal) signals.push(ctx.signal);
    const signal = AbortSignal.any(signals);

    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || signal.aborted) return;
      const headers = new Headers();
      for (const [key, value] of Object.entries(auth.headers ?? {})) {
        if (value !== null) headers.set(key, value);
      }
      const hasAuthOverride = Object.keys(auth.headers ?? {}).some((key) => key.toLowerCase() === "authorization");
      if (auth.apiKey && !hasAuthOverride) {
        headers.set("authorization", `Bearer ${auth.apiKey}`);
      }
      const props = await discoverEfforts(auth.baseUrl ?? model.baseUrl, model.id, headers, signal);
      if (signal.aborted || ctx.model !== model) return;
      const next = withReasoningEfforts(model, props);
      if (!next) return;

      const level = pi.getThinkingLevel();
      enhanced.add(next);
      if (await pi.setModel(next)) pi.setThinkingLevel(level);
    } catch {
      if (!controller.signal.aborted && !ctx.signal?.aborted && !warned.has(model.id)) {
        warned.add(model.id);
        ctx.ui.notify("llama.cpp reasoning discovery failed; keeping Pi's existing settings.", "warning");
      }
    } finally {
      if (pending === controller) pending = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => update(ctx));
  pi.on("model_select", async (_event, ctx) => update(ctx));
  // /llama or another extension may replace the active model with a fresh catalog entry.
  pi.on("before_agent_start", async (_event, ctx) => update(ctx));
  pi.on("session_shutdown", () => {
    pending?.abort();
    pending = undefined;
  });
}
