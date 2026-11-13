# Vision

## Goal

Seamlessly fix the gaps in Pi’s llama.cpp integration, starting with reasoning controls.

Users connect to a router, load a model, and use Pi’s normal controls. Supported reasoning levels come from the model, not a hardcoded assumption. No parallel provider, model manager, or configuration workflow.

Only add functionality missing from built-in Pi. Other integration gaps need evidence and a defined scope before implementation.

## Current scope

- Discover native reasoning efforts for the selected, loaded router model.
- Expose those efforts through Pi’s existing thinking selector.
- Send the selected effort without changing token budgets or sampling.
- Preserve explicit reasoning configuration; fall back when discovery is unavailable.

No changes to authentication, model loading, downloads, classifiers, or other providers.

## Design decisions

### Keep the built-in provider

Pi 1.5.2 exposes `pi.setModel()`, which accepts a model copy with an updated thinking map and compatibility settings. The selector and request serializer use that copy.

The extension updates only the active session model. It does not register a provider, mutate the provider catalog, or write settings. This avoids copying Pi’s model-management and authentication code.

### Discover capabilities through llama.cpp

Check `/models` first. Query `/props?model=…` only when the selected model is reported as loaded; querying an unloaded or sleeping model can load or wake it. A shared router can change state between these requests, so the status check is best-effort.

Example `/props` fields:

```json
{
  "chat_template_caps": {
    "supports_reasoning_effort": true,
    "supports_preserve_reasoning": true,
    "reasoning_effort_levels": ["low", "medium", "xhigh"]
  }
}
```

This is a llama.cpp-specific interface, not an OpenAI standard. llama.cpp infers efforts by probing template rendering with `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Identical renders may collapse aliases; custom names may be missed.

Only expose recognized, reported efforts. Do not invent aliases such as `high` → `xhigh`. Missing, empty, or unrecognized lists leave Pi’s model unchanged.

### Reuse Pi’s serializer

The enhanced model uses `thinkingFormat: "chat-template"`. Template kwargs resolve through Pi’s existing variables:

- `thinking.enabled`: Pi’s existing thinking toggle, where present.
- `thinking.effort`: selected native effort from the thinking map; omitted when off.
- `preserve_thinking`: retained for Pi’s Qwen toggle path, or enabled when the server reports preservation support.

Selecting `medium` for the Qwen example sends:

```json
{
  "chat_template_kwargs": {
    "enable_thinking": true,
    "preserve_thinking": true,
    "reasoning_effort": "medium"
  }
}
```

llama.cpp merges these kwargs over server defaults. No separate request-rewriting hook is needed.

### Keep effort, budgets, and off support separate

- Native effort changes the template’s reasoning instructions; it is not a fixed token count.
- Existing Pi budget fields and per-level sampling remain untouched. A server-side `--reasoning-budget 2048` still caps thinking at 2048 tokens at `xhigh`.
- An effort list does not establish support for disabling thinking. Preserve Pi’s existing toggle; do not add a new one based on the list alone.

### Preserve explicit configuration

Skip models with `reasoning: false`, custom thinking maps/formats, explicit template kwargs, or an existing native-effort configuration.

This also means the extension cannot distinguish an explicit reasoning disable from a template Pi failed to recognize. For now, Pi must already mark the model as reasoning-capable. Supporting missed templates without overriding user intent needs a clearer configuration/provenance hook.

### Bound discovery and discard stale results

- Discover at session start and model selection.
- Reapply before a prompt when the active model has been replaced with a fresh catalog entry.
- Cache enhanced model objects for the extension instance; do not query on every request.
- Use Pi’s resolved endpoint and credentials, including custom headers.
- Bound discovery with a three-second timeout; cancel on model changes or shutdown.
- Discard results if the active model changed while discovery was running.
- Warn once per model on discovery errors; leave its settings unchanged.

### Do not promise rediscovery on reload

Pi 1.5.2 can retain the enhanced active model across `/reload`. The fresh extension instance sees its `chat-template` settings as explicit configuration and skips discovery.

A blind review reproduced this with the actual Pi loader and `session.reload()`: no discovery requests, old efforts retained after the server’s reported capabilities changed. The integration test covers this behavior. Restarting Pi is the current refresh path.

Do not relax override detection just to accept previously enhanced models; that risks overwriting real user configuration.

## Code map

- `extensions/index.ts`: lifecycle hooks, authentication, cancellation, active-model replacement.
- `extensions/lib/reasoning.ts`: candidate checks, capability discovery, model transformation.
- `tests/lifecycle.test.mjs`: lifecycle, stale results, cancellation, headers, fallback.
- `tests/reasoning.test.mjs`: mapping, configuration preservation, discovery guards.
- `tests/pi-integration.test.mjs`: actual Pi loader, built-in provider, selector, serializer, reload behavior.

## Development

```bash
npm ci
npm run check
npm test
npm pack --dry-run
```

Try a checkout without changing Pi settings:

```bash
pi -e ./extensions/index.ts
```

Project setup follows `pi-minimal-footer`: TypeScript under `extensions/`, Node tests, strict type checking, explicit package files, and host-provided Pi packages as peer dependencies.

## Verification

- Pi 1.5.2; Node.js 22.19.0 and 26.10.0.
- 22 passing tests, including real Pi integration against a local HTTP fixture.
- Packed extension loaded through Pi’s loader.
- Read-only discovery against a running llama.cpp router with Qwen3.8-27B reported `low`, `medium`, and `xhigh`.
- Live model generation remains unverified.

## Next evidence needed

- Live generation with each supported effort and off mode.
- A safe refresh path that distinguishes extension-owned metadata from user overrides.
- Support for reasoning-capable templates missed by Pi’s current detection, without overriding explicit disables.

## Documentation boundary

- `README.md`: user setup, usage, and practical limitations.
- `CHANGELOG.md`: concise user-visible release changes only.
- `vision.md`: high-level goal, scope, design decisions, technical details, development, and verification.
- Keep developer notes and implementation history out of README and changelog.
