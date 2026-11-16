# pi-llama-reasoning

<p>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/v/pi-llama-reasoning" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/dt/pi-llama-reasoning" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://pi.dev/packages/pi-llama-reasoning"><img src="https://img.shields.io/badge/pi-package-1a1a2e" alt="pi package"></a>
</p>

A [Pi coding agent](https://pi.dev) extension that discovers your loaded llama.cpp model’s **native reasoning effort levels** and adds them to Pi’s built-in thinking selector—not just thinking on/off.

- Choose the reasoning efforts reported by your llama.cpp router, such as `low`, `medium`, and `xhigh`.
- Keep using Pi’s connection, model picker, and `/llama` commands. No extra configuration or replacement provider.
- Pair each effort with Pi’s thinking token budget while preserving custom budgets, sampling settings, and explicit reasoning configuration.
- Automatically keep sessions on separate llama.cpp slots when available; inspect usage with `/llama-slots`.

![Qwen3.8-27B reasoning levels in Pi 1.5.2: Pi alone offers off and medium; with this extension, the selector offers off, low, medium, and xhigh.](https://raw.githubusercontent.com/Ryu-CZ/pi-llama-reasoning/main/media/preview.png)

## Install

Requires Pi **1.5.2** and Node.js **22.19.0+**.

```bash
pi install npm:pi-llama-reasoning
```

Restart Pi after installing.

## Use

1. Connect to your router with `/login llama.cpp` if you haven’t already.
2. Load a model through `/llama`, then select it through `/model`.
3. Run `/thinking`, then choose a reasoning level.

## Session slots

Slot pinning enables automatically when the loaded model exposes its slots. Each participating Pi session keeps a stable slot across turns, reducing cache displacement when agents share one model. No extra Pi configuration is needed.

Run `/llama-slots` to see busy/idle slots, prompt/cache counters, and local session assignments. The footer shows this session’s assigned slot or why it is unpinned.

- The server must expose slots (`--slots`); multiple sessions need multiple slots (`--parallel`). Use `--kv-unified` to share the context pool instead of splitting it into fixed slot partitions. This extension does not change server settings.
- On tested llama.cpp build `b12277-7c2653acc`, use `--no-cache-idle-slots` with pinning: eager idle-slot clearing otherwise caused one session to lose its reusable prefix. Idle caches can still be reclaimed under memory pressure.
- Coordination covers extension instances sharing the same user cache on one machine, router URL, and model ID—not other clients or machines.
- If inspection or coordination fails, or all slots are busy or leased, requests continue unchanged with a warning. **This is best-effort cache affinity, not strict isolation:** unpinned or external clients can still displace cached prefixes.
- Explicit slot and cache settings are preserved. Pinning cannot prevent cache eviction under memory pressure or model reloads.
- Prompt/cache counters are snapshots, not total KV memory usage. A single-slot model cannot isolate multiple sessions.

## Limits

- Only discovers levels for loaded models that Pi already recognizes as reasoning-capable.
- Requires router-reported efforts using `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Missing reports or any custom label leave Pi unchanged.
- Keeps custom reasoning settings, budget overrides, and sampling settings unchanged.
- Per-request thinking budgets override the server’s default reasoning budget, not its total output or context limits.
- **Restart Pi** after changing a model’s available reasoning levels; `/reload` won’t refresh them.
- If discovery is unavailable, keeps Pi’s existing behavior.

## How it works

With the extension, `medium` selects the model’s medium effort—not just thinking on—and sends Pi’s corresponding thinking token budget.

Pi 1.5.2 defaults to 2,048 thinking tokens for `low`, 8,192 for `medium`, and 16,384 for `high`, `xhigh`, or `max`, when those efforts are available. Custom `thinkingBudgets` settings are respected; `xhigh` and `max` use the `high` budget. Pi reduces budgets when needed to reserve answer space within the output limit.

Effort and budget remain different controls: the model’s template interprets effort, while llama.cpp limits thinking tokens. Off mode keeps Pi’s existing thinking toggle and sends no budget.

For an eligible, loaded model:

![Pi asks the extension to discover reasoning efforts. The extension checks that the selected model is loaded, reads its native efforts, and enables them with Pi’s thinking budgets. Pi sends the prompt with the chosen effort and budget.](https://raw.githubusercontent.com/Ryu-CZ/pi-llama-reasoning/main/media/reasoning-flow.png)

See [vision.md](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md) for the detailed flow, design decisions, and implementation details.
