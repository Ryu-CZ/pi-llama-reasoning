import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as discovery from "./lib/discovery.ts";
import * as reasoning from "./lib/reasoning.ts";

// Optional discovery should not hold up startup or prompting for Pi's full request timeout.
const DISCOVERY_TIMEOUT_MS = 3000;

export default function (pi: ExtensionAPI) {
  const warnedModelIds = new Set<string>();
  let pendingDiscovery: AbortController | undefined;

  async function refreshReasoningEfforts(ctx: ExtensionContext) {
    pendingDiscovery?.abort();
    const model = ctx.model;
    if (!model || !reasoning.isAutomaticCandidate(model)) return;

    const controller = new AbortController();
    pendingDiscovery = controller;
    const signals = [controller.signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)];
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
      const props = await discovery.fetchLoadedModelProps(auth.baseUrl ?? model.baseUrl, model.id, headers, signal);
      if (signal.aborted || ctx.model !== model) return;
      const enhancedModel = reasoning.withReasoningEfforts(model, props);
      if (!enhancedModel) return;

      const thinkingLevel = pi.getThinkingLevel();
      if (await pi.setModel(enhancedModel)) pi.setThinkingLevel(thinkingLevel);
    } catch {
      if (!controller.signal.aborted && !ctx.signal?.aborted && !warnedModelIds.has(model.id)) {
        warnedModelIds.add(model.id);
        ctx.ui.notify("llama.cpp reasoning discovery failed; keeping Pi's existing settings.", "warning");
      }
    } finally {
      if (pendingDiscovery === controller) pendingDiscovery = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => refreshReasoningEfforts(ctx));
  pi.on("model_select", async (_event, ctx) => refreshReasoningEfforts(ctx));
  // /llama or another extension may replace the active model with a fresh catalog entry.
  pi.on("before_agent_start", async (_event, ctx) => refreshReasoningEfforts(ctx));
  pi.on("session_shutdown", () => {
    pendingDiscovery?.abort();
    pendingDiscovery = undefined;
  });
}
