# pi-llama-reasoning

Adds native reasoning effort selection to Pi's built-in llama.cpp integration.

## Boundaries

- Reuse the built-in provider, model picker, authentication, and `/llama` commands.
- No provider replacement, copied catalogs, global settings writes, or model loading.
- Read native efforts from `/props` → `chat_template_caps`; budgets are separate.
- Preserve explicit reasoning configuration and fall back when discovery is unavailable.
- Read the installed Pi docs and trace the actual API before changing integration code.

## Layout

- `extensions/index.ts`: Pi lifecycle integration.
- `extensions/lib/`: reasoning discovery and model transformation.
- `tests/`: Node tests, including Pi loader/provider/serializer integration.
- `README.md`: behavior, installation, limitations.
- `CHANGELOG.md`: short, user-facing Keep a Changelog entries.

## Checks

```bash
npm run check
npm test
npm pack --dry-run
```

Use the package's pinned development versions. Do not claim compatibility with untested Pi versions.

## Workflow

- Commit each verified logical unit separately.
- Update the changelog for user-visible changes, not internal test/setup work.
- Do not publish, tag, push, install globally, or change live server presets unless asked.
