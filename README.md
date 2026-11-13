# pi-llama-reasoning

Adds reasoning levels from llama.cpp’s router to Pi’s thinking selector.

Work in progress. Extends Pi’s built-in `llama.cpp` provider; does not replace model management or authentication.

## Development

Requires Node.js >=22.19.0. Targets Pi 1.5.2.

```bash
npm ci
npm run check
npm test
```

Try without changing Pi settings:

```bash
pi -e ./extensions/index.ts
```
