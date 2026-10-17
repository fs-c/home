# Home Hub

Early prototype: a hub for home-related notes, TODOs and links, organised by the
rooms of a floor plan you trace yourself.

Tooling is managed with [mise](https://mise.jdx.dev) (see `mise.toml`):

```sh
mise install
pnpm install
pnpm dev
```

## How it works

1. **Plan** mode: upload a floor plan (image or PDF) as a stencil, set the scale
   by measuring a known dimension, then trace rooms:
   - **Magic wand** (W): click inside a room; walls are detected from the image.
   - **Rectangle** (R) / **Polygon** (P): manual drawing with snapping to existing
     corners/walls, alignment guides, 45° angle lock and typed lengths.
   - **Select** (V): drag corners, walls or whole rooms; add/remove corners.
2. **Home** mode: clean view of your rooms; attach TODOs, notes and links per room.

Everything is stored in the browser (localStorage + IndexedDB for images).
Use Export/Import to back up or move data as a single JSON file.

## Testing

```sh
pnpm typecheck     # app + tests
pnpm test          # unit tests (Vitest): geometry, snapping, room detection
pnpm test:e2e      # browser tests (Playwright; first run: pnpm exec playwright install chromium)
```

- `tests/unit` – pure logic, fast.
- `tests/e2e` – full flows in Chromium against the dev server: tracing with the
  wand and manual tools, PDF upload, export/import, and tracing the rotated photo
  in `samples/` (skipped if the sample is absent). Fixtures live in
  `tests/e2e/fixtures`; `make-plan.mjs` regenerates the synthetic plan.
- Set `PLAYWRIGHT_OUTPUT_DIR` to put test artifacts somewhere other than `test-results/`.

To tune room detection against a real plan, render what the wand sees:

```sh
pnpm wand-harness samples/stockhofstrasse-top37.jpg '{"kitchen":[1140,1600]}'
# → test-results/wand-harness.png (wall mask in red, detected rooms in green)
```

## Layout

- `src/model` – document types, persistence, undo history
- `src/editor` – canvas (SVG), snapping, magic-wand room detection
- `src/panels` – sidebars, toolbar, room details
- `src/lib` – geometry helpers, file loading
- `tests/` – unit and e2e tests; `scripts/` – dev tools
