import { isRecord } from "./records.ts";

export async function fetchLoadedModelProps(
  baseUrl: string,
  modelId: string,
  headers: HeadersInit,
  signal: AbortSignal,
): Promise<unknown> {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
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
