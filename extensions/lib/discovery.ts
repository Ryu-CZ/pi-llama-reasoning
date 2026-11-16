import { isRecord } from "./records.ts";

export function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export interface SlotSnapshot {
  id: number;
  busy: boolean;
  context: number | undefined;
  prompt: number | undefined;
  processed: number | undefined;
  cached: number | undefined;
}

function counter(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

export async function fetchLoadedModelSlots(
  baseUrl: string,
  modelId: string,
  headers: HeadersInit,
  signal: AbortSignal,
): Promise<SlotSnapshot[] | undefined> {
  const props = await fetchLoadedModelProps(baseUrl, modelId, headers, signal);
  if (!isRecord(props) || props.endpoint_slots !== true || !Number.isSafeInteger(props.total_slots) ||
      (props.total_slots as number) < 1) return undefined;
  const url = new URL(`${serverRoot(baseUrl)}/slots`);
  url.searchParams.set("model", modelId);
  const response = await fetch(url, { headers, signal, redirect: "error" });
  if (!response.ok) throw new Error(`llama.cpp slot inspection returned HTTP ${response.status}`);
  const reported: unknown = await response.json();
  if (!Array.isArray(reported) || reported.length !== props.total_slots) return undefined;
  const ids = new Set<number>();
  const slots: SlotSnapshot[] = [];
  for (const entry of reported) {
    if (!isRecord(entry) || counter(entry.id) === undefined || typeof entry.is_processing !== "boolean" ||
        (entry.id as number) >= (props.total_slots as number) || ids.has(entry.id as number)) return undefined;
    const id = entry.id as number;
    ids.add(id);
    slots.push({ id, busy: entry.is_processing, context: counter(entry.n_ctx), prompt: counter(entry.n_prompt_tokens),
      processed: counter(entry.n_prompt_tokens_processed), cached: counter(entry.n_prompt_tokens_cache) });
  }
  return slots;
}

export async function fetchLoadedModelProps(
  baseUrl: string,
  modelId: string,
  headers: HeadersInit,
  signal: AbortSignal,
): Promise<unknown> {
  const root = serverRoot(baseUrl);
  const get = async (url: URL) => {
    const response = await fetch(url, { headers, signal, redirect: "error" });
    if (!response.ok) throw new Error(`llama.cpp discovery returned HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  };
  const catalog = await get(new URL(`${root}/models`));
  if (!isRecord(catalog) || !Array.isArray(catalog.data)) return undefined;
  const model = catalog.data.find((entry: unknown) => isRecord(entry) && entry.id === modelId);
  // Querying /props can load an unloaded model or wake a sleeping one.
  if (!isRecord(model) || !isRecord(model.status) || model.status.value !== "loaded") return undefined;
  const url = new URL(`${root}/props`);
  url.searchParams.set("model", modelId);
  return get(url);
}
