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
- `README.md`: user installation, usage, practical limitations only.
- `CHANGELOG.md`: short, user-facing Keep a Changelog entries only.
- `vision.md`: high-level goal, scope, design decisions, technical details, development, verification.

## Checks

```bash
npm run check
npm test
npm pack --dry-run
```

Use the package's pinned development versions. Do not claim compatibility with untested Pi versions.

## Workflow

- Commit each verified logical unit separately.
- README and changelog are strictly for users. Put implementation details, developer instructions, design decisions, and verification notes in `vision.md`.
- Update the changelog for user-visible changes, not internal test/setup work or documentation moves.
- Do not publish, tag, push, install globally, or change live server presets unless asked.
