# pi-llama-reasoning

<p>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/v/pi-llama-reasoning" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/dt/pi-llama-reasoning" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://pi.dev/packages/pi-llama-reasoning"><img src="https://img.shields.io/badge/pi-package-1a1a2e" alt="pi package"></a>
</p>

Extends [Pi](https://pi.dev)’s built-in llama.cpp integration with native reasoning-effort selection and automatic session slot pinning.

![Pi 1.5.2 with and without the extension: discover and select native reasoning levels; keep agents A and B on separate slots to support cache reuse. The unpinned example shows B displacing A’s cached context while another slot is unused. Pinning does not guarantee cache retention.](https://raw.githubusercontent.com/Ryu-CZ/pi-llama-reasoning/main/media/readme-preview.png)

## Why use it?

Pi already handles connection, model selection, and generation. This extension adds:

- **Native reasoning levels:** choose model-reported efforts such as `low`, `medium`, and `xhigh` through Pi’s thinking selector.
- **Automatic slot pinning:** keep sessions on separate available server slots across turns, reducing the chance that agents displace each other’s cached conversations.

No replacement provider or new connection setup. Keep Pi’s usual login, model picker, and `/llama` commands.

## Install

Supports Pi **1.5.2 through 1.6.0**. Requires Node.js **22.19.0+**.

```bash
pi install npm:pi-llama-reasoning
```

Restart Pi after installing.

## Use

1. Connect to your llama.cpp router with `/login llama.cpp` if you haven’t already.
2. Load a model through `/llama`, then select it through `/model`.
3. Run `/thinking` and choose a reasoning level.

Native efforts use Pi’s thinking token budgets. Explicit reasoning, budget, sampling, slot, and cache settings are preserved. Thinking tokens still count toward the model’s output and context limits.

## Sharing a model between agents

A server slot can retain a session’s cached conversation between turns. Assignments are automatic when slots are available; no extra Pi setup is needed.

Run `/llama-slots` to inspect slots, busy/idle state, counters, and local session assignments. The footer shows your slot or why it has no assignment.

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

The server needs slot inspection enabled and enough slots for your sessions. For example, our tested three-slot setup uses:

```text
--slots --parallel 3 --kv-unified --no-cache-idle-slots
```

These are **server options**, not Pi options: three slots share one context pool, and idle caches aren’t cleared on every new request. The extension does not change server settings. See the [tested setup](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md#live-multi-slot-setup-and-verification) for details.

- Coordination is local: sessions must share a machine, local cache, server, and model.
- If no slot is available or inspection fails, requests continue without an assignment and Pi shows a warning.
- Pinning supports cache reuse, not guaranteed retention. Other clients, server settings, memory pressure, or model reloads can still force reprocessing.

## Limits

- Reasoning levels appear only for loaded models that Pi recognizes as reasoning-capable and whose server reports supported level names.
- If discovery fails or the reported levels are unsupported, Pi keeps its usual behavior.
- **Restart Pi** after changing a model’s available reasoning levels; `/reload` won’t refresh them.

See [vision.md](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md) for design, implementation, and development notes.
