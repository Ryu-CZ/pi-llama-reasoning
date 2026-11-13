# pi-llama-reasoning

Adds reasoning levels from llama.cpp’s router to Pi’s thinking selector.

Keep using Pi’s existing connection, model picker, and `/llama` commands. No extra configuration.

## Install

Requires Node.js >=22.19.0 and Pi 1.5.2.

From npm, after publication:

```bash
pi install npm:pi-llama-reasoning
```

Restart Pi after installing.

## Use

1. Connect to your router with `/login llama.cpp` if you haven’t already.
2. Load a model through `/llama`, then select it through `/model`.
3. Choose a reasoning level in Pi’s thinking selector.

For example, Qwen3.8-27B offers `low`, `medium`, and `xhigh`, plus Pi’s existing `off` option. Choosing `medium` now selects the model’s medium effort—not just a larger thinking budget.

## Limits

- Only discovers levels for loaded models that Pi already recognizes as reasoning-capable.
- Keeps custom reasoning settings, token budgets, and sampling settings unchanged.
- Server token limits still apply, even at `xhigh`.
- Restart Pi after changing a model’s available reasoning levels; `/reload` won’t refresh them.
- If discovery is unavailable, keeps Pi’s existing behavior.
