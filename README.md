# pi-llama-reasoning

<p>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/v/pi-llama-reasoning" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/pi-llama-reasoning"><img src="https://img.shields.io/npm/dt/pi-llama-reasoning" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/pi-llama-reasoning" alt="license"></a>
  <a href="https://pi.dev/packages/pi-llama-reasoning"><img src="https://img.shields.io/badge/pi-package-1a1a2e" alt="pi package"></a>
</p>

Adds reasoning levels from llama.cpp’s router to Pi’s thinking selector.

Keep using Pi’s existing connection, model picker, and `/llama` commands. No extra configuration.

## What it solves

llama.cpp reports the model’s reasoning levels, but Pi 1.5.2 doesn’t use that list. This extension adds them to Pi’s thinking selector and sends your choice to the model.

![Qwen3.8-27B reasoning levels in Pi 1.5.2: Pi alone offers off and medium; with this extension, the selector offers off, low, medium, and xhigh. Token budgets stay unchanged.](https://raw.githubusercontent.com/Ryu-CZ/pi-llama-reasoning/main/media/preview.png)

Without the extension, Pi’s `medium` enables thinking but leaves the server’s effort setting unchanged. With it, `medium` selects the model’s medium effort. Token budgets stay separate.

See [vision.md](https://github.com/Ryu-CZ/pi-llama-reasoning/blob/main/vision.md) for the information-flow diagram, design decisions, and implementation details.

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

## Limits

- Only discovers levels for loaded models that Pi already recognizes as reasoning-capable.
- Keeps custom reasoning settings, token budgets, and sampling settings unchanged.
- Server token limits still apply, even at `xhigh`.
- Restart Pi after changing a model’s available reasoning levels; `/reload` won’t refresh them.
- If discovery is unavailable, keeps Pi’s existing behavior.

## License

[MIT](LICENSE).
