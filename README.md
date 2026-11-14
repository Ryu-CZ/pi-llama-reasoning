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
- Leave token budgets, sampling settings, and explicit reasoning configuration unchanged.

![Qwen3.8-27B reasoning levels in Pi 1.5.2: Pi alone offers off and medium; with this extension, the selector offers off, low, medium, and xhigh. Token budgets stay unchanged.](https://raw.githubusercontent.com/Ryu-CZ/pi-llama-reasoning/main/media/preview.png)

## Install

Requires Pi **1.5.2** and Node.js **22.19.0+**.

```bash
pi install npm:pi-llama-reasoning
```

Restart Pi after installing.

## Use

1. Connect to your router with `/login llama.cpp` if you haven’t already.
2. Load a model through `/llama`, then select it through `/model`.
3. Choose a reasoning level in Pi’s thinking selector.

## Limits

- Only discovers levels for loaded models that Pi already recognizes as reasoning-capable.
- Keeps custom reasoning settings, token budgets, and sampling settings unchanged.
- Server token limits still apply, even at `xhigh`.
- **Restart Pi** after changing a model’s available reasoning levels; `/reload` won’t refresh them.
- If discovery is unavailable, keeps Pi’s existing behavior.

## How it works

With the extension, `medium` selects the model’s medium effort—not just thinking on. Token budgets stay separate.

```mermaid
%%{init: {"theme": "neutral", "fontFamily": "monospace", "sequence": {"width": 200, "mirrorActors": false}}}%%
sequenceDiagram
    participant Pi
    participant Ext as This extension
    participant Router as llama.cpp
    Pi->>Ext: Model selected
    Ext->>Router: Discover supported levels
    Router-->>Ext: low, medium, xhigh (example)
    Ext->>Pi: Add levels to thinking selector
    Pi->>Router: Send prompt with chosen effort
```

See [vision.md](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md) for the detailed flow, design decisions, and implementation details.
