import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveConnection } from "./connection.ts";
import { fetchLoadedModelSlots, serverRoot } from "./discovery.ts";
import { isRecord } from "./records.ts";
import { SlotLeases } from "./slot-leases.ts";

function modelKey(ctx: ExtensionContext): string {
  return JSON.stringify([ctx.model?.provider, ctx.model?.api, ctx.model?.baseUrl, ctx.model?.id]);
}

function isLlamaChat(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "llama.cpp" && ctx.model.api === "openai-completions";
}

function scopeOf(baseUrl: string, modelId: string): string {
  const url = new URL(serverRoot(baseUrl));
  // These names address the same local IPv4 router; other aliases need the same configured URL.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return createHash("sha256").update(JSON.stringify([url.href, modelId])).digest("hex");
}

export function registerSlotPinning(pi: ExtensionAPI, leases = new SlotLeases()) {
  let epoch = 0;
  let activeModel: string | undefined;
  let pending: AbortController | undefined;
  let lastWarning: string | undefined;
  let enabled = true;
  let currentCtx: ExtensionContext | undefined;

  pi.on("session_start", (_event, ctx) => { currentCtx = ctx; });

  const unsubscribeControl = pi.events.on("pi-llama-reasoning:set-slot-management", (data) => {
    if (!isRecord(data)) return;
    const reply = (ok: boolean, reason?: string) => {
      if (typeof data.reply === "function") data.reply({ ok, enabled, ...(reason ? { reason } : {}) });
      else if (!ok) currentCtx?.ui.notify(`llama slot management unchanged: ${reason}`, "warning");
    };
    if (typeof data.enabled !== "boolean") return reply(false, "invalid-request");
    if (data.enabled === enabled) return reply(true);
    // Do not relinquish a slot between payload preparation and the request reaching the server.
    if (pending || (currentCtx && !currentCtx.isIdle())) return reply(false, "busy");
    if (!data.enabled) {
      try {
        leases.release();
      } catch {
        return reply(false, "cleanup-failed");
      }
    }
    enabled = data.enabled;
    lastWarning = undefined;
    currentCtx?.ui.setStatus("llama-slots", undefined);
    reply(true);
  });

  function status(ctx: ExtensionContext, message: string, warning = false) {
    ctx.ui.setStatus("llama-slots", message);
    if (warning && lastWarning !== message) ctx.ui.notify(message, "warning");
    lastWarning = warning ? message : undefined;
  }

  function release(ctx: ExtensionContext) {
    epoch++;
    pending?.abort();
    pending = undefined;
    try {
      leases.release();
    } catch {
      ctx.ui.notify("llama slot lease cleanup failed; an old assignment may remain until this process exits.", "warning");
    }
    ctx.ui.setStatus("llama-slots", undefined);
    lastWarning = undefined;
  }

  pi.on("model_select", (_event, ctx) => {
    const key = modelKey(ctx);
    if (activeModel !== key) release(ctx);
    activeModel = key;
  });
  pi.on("session_shutdown", (_event, ctx) => {
    unsubscribeControl();
    release(ctx);
    try {
      leases.close();
    } catch {
      ctx.ui.notify("llama slot lease close failed; an old assignment may remain until this process exits.", "warning");
    }
  });

  async function inspect(ctx: ExtensionContext, signal: AbortSignal) {
    const model = ctx.model;
    if (!model || !isLlamaChat(ctx)) return undefined;
    const connection = await resolveConnection(ctx, signal);
    if (!connection || signal.aborted) return undefined;
    const slots = await fetchLoadedModelSlots(connection.baseUrl, model.id, connection.headers, signal);
    if (!slots) return undefined;
    return { slots, scope: scopeOf(connection.baseUrl, model.id) };
  }

  pi.on("before_provider_request", async (event, ctx) => {
    if (!enabled || !isLlamaChat(ctx) || !isRecord(event.payload) || event.payload.model !== ctx.model?.id ||
        !Array.isArray(event.payload.messages)) return;
    activeModel = modelKey(ctx);
    const currentEpoch = epoch;
    const controller = new AbortController();
    pending = controller;
    const signals = [controller.signal, AbortSignal.timeout(3000)];
    if (ctx.signal) signals.push(ctx.signal);
    const signal = AbortSignal.any(signals);
    try {
      const inspected = await inspect(ctx, signal);
      if (signal.aborted || currentEpoch !== epoch || activeModel !== modelKey(ctx)) return;
      if (!inspected) {
        leases.release();
        status(ctx, "llama slots: unavailable; unpinned", true);
        return;
      }
      const explicit = event.payload.id_slot;
      if (explicit !== undefined && (!Number.isSafeInteger(explicit) || (explicit as number) < 0)) {
        leases.release();
        status(ctx, "llama slots: explicit server selection; unpinned", true);
        return;
      }
      const { slots, scope } = inspected;
      // llama.cpp wraps explicit nonnegative IDs modulo its slot count.
      const requestedSlot = explicit === undefined ? undefined : (explicit as number) % slots.length;
      const slot = leases.acquire(scope, ctx.sessionManager.getSessionId(), slots.map((s) => s.id),
        slots.filter((s) => s.busy).map((s) => s.id), requestedSlot);
      if (slot === undefined) {
        status(ctx, explicit === undefined ? "llama slots: all busy or leased; unpinned" :
          "llama slots: explicit slot unavailable; request unchanged", true);
        return;
      }
      status(ctx, `llama slot: ${slot}${event.payload.cache_prompt === false ? " (cache disabled)" : ""}`);
      return { ...event.payload, id_slot: explicit === undefined ? slot : explicit,
        cache_prompt: event.payload.cache_prompt === undefined ? true : event.payload.cache_prompt };
    } catch {
      if (!controller.signal.aborted && !ctx.signal?.aborted && currentEpoch === epoch) {
        status(ctx, "llama slots: discovery or coordination failed; request unchanged", true);
      }
    } finally {
      if (pending === controller) pending = undefined;
    }
  });

  pi.registerCommand("llama-slots", {
    description: "Inspect llama.cpp slots and local Pi session leases (read-only)",
    handler: async (_args, ctx) => {
      if (!isLlamaChat(ctx)) {
        ctx.ui.notify("Select a built-in llama.cpp chat model first.", "info");
        return;
      }
      const key = modelKey(ctx);
      try {
        const inspected = await inspect(ctx, AbortSignal.timeout(3000));
        if (key !== modelKey(ctx)) return;
        if (!inspected) {
          ctx.ui.notify("Slot inspection unavailable for this loaded model. No server settings changed.", "warning");
          return;
        }
        const owners = leases.list(inspected.scope);
        const lines = inspected.slots.map((slot, index) => {
          const owner = owners.find((entry) => entry.slotId === slot.id);
          const lease = owner ? `${owner.sessionId === ctx.sessionManager.getSessionId() && owner.pid === process.pid ? "this session" : owner.sessionId} (PID ${owner.pid})` : "no local lease";
          const last = index === inspected.slots.length - 1;
          const indent = last ? "   " : "│  ";
          return [
            `${last ? "└─" : "├─"} Slot ${slot.id}: ${slot.busy ? "busy" : "idle"}`,
            `${indent}├─ context ${slot.context ?? "?"}; prompt ${slot.prompt ?? "?"}; processed ${slot.processed ?? "?"}; cached ${slot.cached ?? "?"}`,
            `${indent}└─ lease: ${lease}`,
          ].join("\n");
        });
        ctx.ui.notify(`${ctx.model?.id}\n${lines.join("\n")}\nSnapshot only. Counters are not total KV memory usage; local leases do not identify external clients.`, "info");
      } catch {
        ctx.ui.notify("Slot inspection failed; server or local lease data unavailable.", "warning");
      }
    },
  });
}
