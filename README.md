# pi-llama-reasoning

Adds reasoning levels from llama.cpp’s router to Pi’s thinking selector.

Uses Pi’s built-in `llama.cpp` provider. No duplicate provider, model manager, commands, or settings files.

## Try it

Requires Node.js >=22.19.0 and Pi 1.5.2. Not published yet.

```bash
git clone https://github.com/Ryu-CZ/pi-llama-reasoning.git
cd pi-llama-reasoning
pi -e ./extensions/index.ts
```

Keep your existing `/login llama.cpp` connection. Load a model through `/llama`, then select it through `/model`.

To keep the extension installed:

```bash
pi install /absolute/path/to/pi-llama-reasoning
```

## What changes

For a loaded model reporting this in `/props`:

```json
"chat_template_caps": {
  "supports_reasoning_effort": true,
  "reasoning_effort_levels": ["low", "medium", "xhigh"]
}
```

Pi’s thinking selector offers `low`, `medium`, and `xhigh`, plus `off` if Pi already provides a thinking toggle. Selecting `medium` sends:

```json
"chat_template_kwargs": {
  "enable_thinking": true,
  "preserve_thinking": true,
  "reasoning_effort": "medium"
}
```

llama.cpp merges these kwargs over server defaults. The extension uses Pi’s existing `chat-template` serializer, not a separate request hook. Thinking preservation is retained for Pi’s existing Qwen toggle path, or enabled when the server reports support.

Token budgets and sampling settings stay unchanged. A server-side `--reasoning-budget 2048` still caps thinking at 2048 tokens, even at `xhigh` effort.

## Boundaries

- Updates the **active session model**, not the provider catalog. Authentication, `/llama`, downloads, classifiers, and other providers stay untouched.
- Discovers efforts at session start and model changes. Reapplies before a prompt if Pi replaces the active model with a fresh catalog entry. Restart Pi to rediscover changed template capabilities; `/reload` retains the enhanced model.
- Checks `/models` first; queries `/props?model=…` only for a model reported as loaded. Does not deliberately load or wake models. A shared router can still change state between those requests.
- Leaves `reasoning: false`, custom thinking maps/formats, and explicit template kwargs unchanged. Pi must already recognize the model as reasoning-capable; effort-only templates that Pi misses need reasoning enabled in Pi’s model configuration first.
- Adds no new off switch. Native effort support alone does not establish that thinking can be disabled.
- Missing, empty, or unrecognized effort lists keep Pi’s existing behavior. Discovery failures warn once per model and leave its settings unchanged.
- llama.cpp probes template rendering to infer efforts. Aliases may be collapsed; custom level names cannot be represented in Pi’s selector.

## Development

```bash
npm ci
npm run check
npm test
npm pack --dry-run
```

Tested with Pi 1.5.2 on Node.js 22.19.0 and 26.10.0. Tests cover discovery, fallback, cancellation, override preservation, and Pi’s actual loader, built-in provider, selector, and request serializer against a local HTTP fixture.

Read-only discovery also verified against a running llama.cpp router with Qwen3.8-27B. Live model generation has not been tested with this extension.
