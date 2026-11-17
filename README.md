# pi-llama-reasoning

<p>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/v/pi-llama-reasoning" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/dt/pi-llama-reasoning" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://pi.dev/packages/pi-llama-reasoning"><img src="https://img.shields.io/badge/pi-package-1a1a2e" alt="pi package"></a>
</p>

Extends [Pi](https://pi.dev)’s built-in llama.cpp integration with native reasoning-effort selection and automatic session slot pinning.

![Pi 1.5.2 alone versus Pi with this extension: default thinking choices become model-reported native effort levels; server-selected slots become stable, colour-matched session assignments. In the unpinned example, A’s blue cached-context blocks are crossed out and replaced by B’s amber blocks in Slot 0 while Slot 1 remains unused; A must rebuild its context on return. With pinning, blue and amber cached contexts remain in separate slots. Pinning supports cache reuse but does not guarantee retention.](https://raw.githubusercontent.com/Ryu-CZ/pi-llama-reasoning/main/media/readme-preview.png)

## Why use it?

Pi 1.5.2’s built-in llama.cpp integration handles connection, model selection, and generation, but does not discover the model’s native reasoning-effort levels or automatically pin sessions to separate server slots. This package adds those two capabilities using information reported by llama.cpp, without replacing Pi’s provider.

**Choose how your model reasons.** Select supported native levels such as `low`, `medium`, and `xhigh` through Pi’s usual thinking selector, with Pi’s thinking token budgets.

**Reduce reprocessing between agents.** Sessions sharing one model can displace each other’s cached conversations. Automatic slot pinning keeps participating sessions on separate available slots across turns, helping reuse their conversation prefixes instead of processing them again. Cache retention still depends on server settings and available memory.

Keep Pi’s usual login, model picker, and `/llama` commands. Your explicit reasoning, budget, sampling, slot, and cache settings are preserved.

## Install

Requires Pi **1.5.2** and Node.js **22.19.0+**.

```bash
pi install npm:pi-llama-reasoning
```

Restart Pi after installing.

## Use

1. Connect to your llama.cpp router with `/login llama.cpp` if you haven’t already.
2. Load a model through `/llama`, then select it through `/model`.
3. Run `/thinking` and choose a reasoning level.

Each level uses Pi’s thinking token budget. Your custom reasoning, budget, and sampling settings are kept. Thinking tokens still count toward the model’s output and context limits.

## Sharing a model between agents

A server slot lets a session reuse its cached conversation between turns. The extension assigns separate slots automatically when available; no extra Pi setup is needed.

Run `/llama-slots` to see a tree of the selected model’s slots, their busy/idle state, counters, and session assignments. The footer shows your session’s slot or why it has no assignment.

Example output (illustrative values; missing counters appear as `?`):

```text
qwen
├─ Slot 0: idle
│  ├─ context 8192; prompt 23; processed 0; cached 0
│  └─ lease: this session (PID 24180)
└─ Slot 1: busy
   ├─ context ?; prompt ?; processed ?; cached ?
   └─ lease: no local lease
Snapshot only. Counters are not total KV memory usage; local leases do not identify external clients.
```

Other extensions can turn automatic slot management off or back on while Pi is idle. This lets another extension manage slots without disabling reasoning support or manual inspection. See the [integration contract](vision.md#slot-management-control) for the event and example.

The server needs slot inspection enabled and enough slots for your sessions. For example, our tested three-slot setup uses:

```text
--slots --parallel 3 --kv-unified --no-cache-idle-slots
```

These are **llama.cpp server options**, not Pi options. They allow three requests to share one context pool and avoid clearing idle sessions’ caches on every new request. The extension does not change your server settings. See [vision.md](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md#live-multi-slot-setup-and-verification) for the tested build and setup details.

- Only sessions on the same machine sharing a local cache, server, and model can coordinate slot assignments.
- If no slot is available or inspection fails, requests continue without an assignment and Pi shows a warning.
- Other clients, memory pressure, or model reloads can force the server to process your conversation again. Your explicit slot and cache settings are kept.

## Limits

- Reasoning levels appear only for loaded models that Pi recognizes as reasoning-capable and whose server reports supported level names.
- If discovery fails or the reported levels are unsupported, Pi keeps its usual behavior.
- **Restart Pi** after changing a model’s available reasoning levels; `/reload` won’t refresh them.

See [vision.md](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md) for design, implementation, and development notes.
