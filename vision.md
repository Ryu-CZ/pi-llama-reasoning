# Vision

## Goal

Seamlessly fix the gaps in Pi’s llama.cpp integration, starting with reasoning controls.

Users connect to a router, load a model, and use Pi’s normal controls. Supported reasoning levels come from the model, not a hardcoded assumption. No parallel provider, model manager, or configuration workflow.

Only add functionality missing from built-in Pi. Other integration gaps need evidence and a defined scope before implementation.

## Current scope

- Discover native reasoning efforts for the selected, loaded router model.
- Expose those efforts through Pi’s existing thinking selector.
- Send the selected effort with Pi’s corresponding thinking token budget, without changing sampling or budget settings.
- Preserve explicit reasoning configuration; fall back when discovery is unavailable.

No changes to authentication, model loading, downloads, classifiers, or other providers.

## Information flow

Pi owns the provider, authentication, model management, thinking selector, and request serializer. The extension discovers native efforts and replaces only the active session model with an enhanced copy.

```mermaid
%%{init: {"theme": "neutral", "fontFamily": "monospace", "sequence": {"noteMargin": 40, "width": 240, "mirrorActors": false}}}%%
sequenceDiagram
    participant Pi as Pi 1.5.2
    participant Ext as pi-llama-reasoning
    participant Router as llama.cpp router

    Note over Pi: Built-in login and catalog<br/>Model loading and selection<br/>Qwen path: off / medium
    Pi->>Ext: Session start, model selection, or before prompt
    Note over Ext: Check automatic candidate<br/>Keep explicit settings intact<br/>Skip enhanced model objects
    Ext->>Pi: Resolve model endpoint, credentials, and headers
    Pi-->>Ext: Existing connection details
    Ext->>Router: GET /models
    Router-->>Ext: Selected model status
    alt Selected model is loaded
        Ext->>Router: GET /props?model=selected-id
        Router-->>Ext: chat_template_caps
        Note over Ext: Require supports_reasoning_effort<br/>Read reasoning_effort_levels<br/>Example: low, medium, xhigh
        opt Reported efforts are supported Pi labels
            Ext->>Pi: pi.setModel(enhanced active-model copy)
            Note over Pi: Inject thinkingLevelMap<br/>thinkingFormat: chat-template<br/>Map native reasoning_effort<br/>from thinking.effort<br/>Keep existing off toggle
        end
    else Not loaded
        Note over Ext: Stop discovery<br/>Leave active model unchanged
    end
    opt Enhancement applied: user selects medium
        Pi->>Pi: Thinking selector reads new map
        Pi->>Router: Built-in serializer: POST /v1/chat/completions<br/>chat_template_kwargs.reasoning_effort = medium
        Router-->>Pi: Stream model response
    end
```

The injected `compat.chatTemplateKwargs` are metadata for Pi’s existing serializer, not a second HTTP client for generation. The extension also retains the Qwen toggle/preservation behavior where applicable. It enables `compat.thinkingTokenBudgetField: "thinking_budget_tokens"` when neither an explicit budget field nor a legacy budget flag is configured. Pi’s serializer then sends the level’s resolved budget alongside its native effort. It does not change budget settings, sampling, the provider catalog, or persistent settings.

Missing or unsupported capabilities and discovery failures leave the model unchanged. The loaded-status guard is best-effort: a shared router can change state between `/models` and `/props`. Generation in the diagram shows the intended request path; live generation remains unverified.

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
  },
  "thinking_budget_tokens": 8192
}
```

llama.cpp merges these kwargs over server defaults. No separate request-rewriting hook is needed.

### Keep effort, budgets, and off support separate

- Native effort changes the template’s reasoning instructions; it is not a fixed token count.
- Enable Pi’s existing budget serializer rather than defining another effort-to-budget map. Pi 1.5.2 uses 1024 / 2048 / 8192 / 16384 for minimal / low / medium / high; xhigh and max share high’s budget. Custom `thinkingBudgets` are honored. Pi clamps the budget to reserve 1024 answer tokens under the output ceiling; if no positive budget remains, Pi omits the field.
- A per-request `thinking_budget_tokens` value overrides llama.cpp’s `--reasoning-budget` default; it is not bounded by that default. Total output and context limits still apply.
- Explicit budget fields, legacy `supportsThinkingTokenBudget` flags (including false), and per-level sampling overrides remain untouched. Pi merges sampling parameters last, so explicit request-body budget values win.
- An effort list does not establish support for disabling thinking. Preserve Pi’s existing toggle; do not add a new one based on the list alone.

### Preserve explicit configuration

Skip models with `reasoning: false`, custom thinking maps/formats, explicit template kwargs, or an existing native-effort configuration.

This also means the extension cannot distinguish an explicit reasoning disable from a template Pi failed to recognize. For now, Pi must already mark the model as reasoning-capable. Supporting missed templates without overriding user intent needs a clearer configuration/provenance hook.

### Bound discovery and discard stale results

- Discover at session start and model selection.
- Reapply before a prompt when the active model has been replaced with a fresh catalog entry.
- Enhanced models use `chat-template`, so the candidate guard skips them; do not query on every request.
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
- `extensions/lib/discovery.ts`: HTTP discovery, loaded-status guard, endpoint paths.
- `extensions/lib/reasoning.ts`: pure eligibility checks, capability validation, model transformation.
- `extensions/lib/records.ts`: shared record guard for untrusted JSON; neither domain module depends on the other.
- `tests/lifecycle.test.mjs`: lifecycle, stale results, cancellation, headers, fallback.
- `tests/discovery.test.mjs`: loaded-status guard, URL prefixes, headers, HTTP failures.
- `tests/reasoning.test.mjs`: effort mapping, configuration preservation, capability validation.
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
- Node tests, including real Pi integration against a local HTTP fixture: default and custom effort budgets, off mode, output-limit clamping, and explicit budget overrides.
- Packed extension loaded through Pi’s loader.
- Read-only discovery against a running llama.cpp router with Qwen3.8-27B reported `low`, `medium`, and `xhigh`.
- Direct live router requests to Qwen3.8-27B with reasoning budgets 0 and 32 verified absent vs bounded reasoning content. Generation through Pi with the new automatic forwarding remains unverified.

## Package discovery experiment

A fresh Pi session in a neutral temporary directory searched public sources with extensions, MCP, skills, context files, and session persistence disabled. Its prompt described the selector-and-budget problem without naming this package or exposing repository metadata. This was one discovery trial, not a ranking benchmark.

Initial queries, recorded before searching:

- `Pi coding agent package llama.cpp reasoning thinking token budget`
- `npm pi llama.cpp native reasoning efforts`
- `github pi extension llama.cpp thinking selector reasoning budget`

After web search hit challenge pages, it searched npm for `pi llama.cpp`, `keywords:pi-package llama`, and `pi reasoning`. It found `pi-llama-cpp` and `pi-reasoning-budget-selector`, but did not find this package or verify a complete native-effort-and-budget solution. Those candidate assessments are the worker’s findings, not an independent audit.

Independent registry checks confirmed that npm still served version 0.1.1 with the old description and only `pi-package`, `pi-extension`, `llama.cpp`, and `reasoning` keywords. This package was absent from the first 250 results for each of the three npm queries; this does not establish absence from all results.

The local description now names both native efforts and token budgets. Keep keywords focused and ordered by relevance: `llama.cpp`, `reasoning-effort`, `thinking-budget`, `reasoning`, `thinking`, `openai-api`, `pi-extension`, then the required gallery marker `pi-package`. The API keyword describes llama.cpp’s OpenAI-compatible endpoint, not a dependency on OpenAI’s hosted service. Avoid standalone budget/effort/token keywords and duplicate spellings. Publish the updated metadata and repeat a fresh blind trial before claiming improved discoverability.

## Code readability

The entry point uses `discovery` and `reasoning` module namespaces to distinguish network I/O from pure transformation. Lifecycle state names identify warned model IDs and pending discovery. Enhanced models already fail the eligibility check because their format is `chat-template`; a separate WeakSet tracked the same exclusion and has been removed. Authentication, cancellation, and active-model replacement stay in the Pi integration layer. Discovery returns raw `/props`, so its name is `fetchLoadedModelProps()`, not an effort parser. `QWEN_THINKING_MAP` names the specific built-in configuration used to detect overrides.

The integration test keeps one real Pi session and local HTTP fixture, with named sequential subtests for discovery, default budgets/off, custom budgets, clamping, catalog replacement, reload, and explicit overrides. Temporary budget/model/server mutations are reset by subtest cleanup. Discovery tests live beside the module they exercise rather than mixing HTTP behavior into the pure transformation tests.

The dead-code/test audit found no unused source exports or obsolete tests. Retained unit and integration overlap covers different boundaries: isolated decisions versus the actual Pi loader/provider/serializer. Strict TypeScript unused checks pass. Node coverage executes every source line (80.12% branch coverage); that supports reachability, not exhaustive branch coverage. All 28 reported tests pass; the increase from 22 comes from naming existing integration scenarios, not new feature coverage. These internal changes do not need a user-facing changelog entry.

## README review corrections

- Verified the usage command against pinned Pi 1.5.2: `handleThinkingCommand()` calls `showThinkingSelector()` when `/thinking` has no argument. README names the existing built-in command; no extension command or runtime behavior changed.
- Documented the all-or-nothing label check in `withReasoningEfforts()`: require `supports_reasoning_effort: true` and a nonempty list containing only Pi-supported effort labels. A mixed list such as `["low", "custom"]` rejects the enhancement, not just the custom entry. Existing malformed-report tests cover this fallback.
- Removed the obsolete budget footer from `media/preview.png` with a bottom crop (1600×900 → 1600×800). Visually checked that the model/version caption and selector comparison remain intact. Removed the historical disclaimer from its README alt text; budget behavior is described in the text, not the image.

## Next evidence needed

- Live generation with each supported effort and off mode.
- A safe refresh path that distinguishes extension-owned metadata from user overrides.
- Support for reasoning-capable templates missed by Pi’s current detection, without overriding explicit disables.

## Documentation boundary

- `README.md`: user setup, usage, and practical limitations.
- `CHANGELOG.md`: concise user-visible release changes only.
- `vision.md`: high-level goal, scope, design decisions, technical details, development, and verification.
- Keep developer notes and implementation history out of README and changelog.
