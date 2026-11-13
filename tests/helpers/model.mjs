export function model(overrides = {}) {
  return {
    id: "qwen", name: "qwen", provider: "llama.cpp", api: "openai-completions",
    baseUrl: "http://localhost:8080/v1", reasoning: true,
    thinkingLevelMap: { off: "off", minimal: null, low: null, medium: "medium", high: null, xhigh: null },
    input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768, maxTokens: 8192,
    compat: { thinkingFormat: "qwen-chat-template", supportsReasoningEffort: false },
    ...overrides,
  };
}

export const props = {
  chat_template_caps: {
    supports_reasoning_effort: true,
    supports_preserve_reasoning: true,
    reasoning_effort_levels: ["low", "medium", "xhigh"],
  },
};
