import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export async function resolveConnection(ctx: ExtensionContext, signal: AbortSignal) {
  const model = ctx.model;
  if (!model) return undefined;
  signal.throwIfAborted();
  const lookup = ctx.modelRegistry.getApiKeyAndHeaders(model);
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  // Pi's credential lookup has no signal parameter; stop waiting without changing its state.
  const auth = await Promise.race([lookup, cancelled])
    .finally(() => signal.removeEventListener("abort", onAbort));
  signal.throwIfAborted();
  if (!auth.ok) return undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(auth.headers ?? {})) {
    if (value !== null) headers.set(key, value);
  }
  const hasAuthOverride = Object.keys(auth.headers ?? {}).some((key) => key.toLowerCase() === "authorization");
  if (auth.apiKey && !hasAuthOverride) headers.set("authorization", `Bearer ${auth.apiKey}`);
  return { baseUrl: auth.baseUrl ?? model.baseUrl, headers };
}
