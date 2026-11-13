import type { Api, Model } from "@earendil-works/pi-ai";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const BUILTIN_MAP = {
  off: "off",
  minimal: null,
  low: null,
  medium: "medium",
  high: null,
  xhigh: null,
};

type ChatModel = Model<"openai-completions">;

export function isAutomaticCandidate(model: Model<Api>): model is ChatModel {
  if (model.provider !== "llama.cpp" || model.api !== "openai-completions" || !model.reasoning) return false;
  const compat = (model as ChatModel).compat;
  if (compat?.thinkingFormat && compat.thinkingFormat !== "qwen-chat-template") return false;
  if (compat?.supportsReasoningEffort || compat?.chatTemplateKwargs) return false;
  if (!model.thinkingLevelMap) return true;
  const entries = Object.entries(model.thinkingLevelMap);
  return entries.length === Object.keys(BUILTIN_MAP).length && entries.every(
    ([key, value]) => Object.hasOwn(BUILTIN_MAP, key) && value === BUILTIN_MAP[key as keyof typeof BUILTIN_MAP],
  );
}

export function withReasoningEfforts(model: Model<Api>, props: unknown): ChatModel | undefined {
  if (!isAutomaticCandidate(model) || !isRecord(props)) return undefined;
  const caps = props.chat_template_caps;
  if (!isRecord(caps) || caps.supports_reasoning_effort !== true) return undefined;
  const reported = caps.reasoning_effort_levels;
  if (!Array.isArray(reported) || reported.length === 0) return undefined;
  // Pi's selector cannot represent arbitrary template-specific names.
  if (reported.some((value) => !EFFORTS.includes(value))) return undefined;

  const thinkingLevelMap: NonNullable<ChatModel["thinkingLevelMap"]> = {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  };
  for (const effort of EFFORTS) {
    if (reported.includes(effort)) thinkingLevelMap[effort] = effort;
  }

  // Preserve Pi's existing toggle; an effort list alone does not establish off support.
  const hasToggle = model.reasoning && model.compat?.thinkingFormat === "qwen-chat-template";
  if (hasToggle) thinkingLevelMap.off = "off";

  return {
    ...model,
    reasoning: true,
    thinkingLevelMap,
    compat: {
      ...model.compat,
      supportsReasoningEffort: false,
      thinkingFormat: "chat-template",
      chatTemplateKwargs: {
        ...(hasToggle ? { enable_thinking: { $var: "thinking.enabled" as const } } : {}),
        ...(hasToggle || caps.supports_preserve_reasoning === true ? { preserve_thinking: true } : {}),
        reasoning_effort: { $var: "thinking.effort", omitWhenOff: true },
      },
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function discoverEfforts(
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
