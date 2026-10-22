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

1. **Home** (the default view): TODOs, notes and links per room, with the plan
   as a small map for orientation – rooms with open TODOs stand out, tapping a
   room shows its contents.
2. **Edit floor plan** (from the menu, or the first-run onboarding): upload a
   floor plan (image or PDF) as a stencil, set the scale by measuring a known
   dimension, then trace rooms:
   - **Draw** (D): place a room's corners, with snapping to existing
     corners/walls, angles snapping parallel/perpendicular to existing walls,
     alignment guides and typed lengths. Rooms never overlap: a new shape is
     trimmed to the space existing rooms leave free, and a path drawn from a
     room's wall through it to another wall splits that room (e.g. trace the
     whole outline first, then split it into rooms).
   - **Select** (V): drag corners, walls or whole rooms; add/remove corners.

   On touch devices, points follow the finger and are placed when it's lifted;
   pinch to zoom, two fingers to pan.

Everything is stored in the browser (localStorage + IndexedDB for images).
Use Export/Import to back up or move data as a single JSON file.

## Testing

Note that the tests are purely agent-curated and might not reflect the "true" intent 
or requirements. Nothing about them is set in stone.

```sh
pnpm typecheck     # app + tests
pnpm test          # unit tests (Vitest): geometry, snapping
```

## Layout

- `src/model` – document types, persistence, undo history
- `src/editor` – canvas (SVG), snapping
- `src/panels` – home view, plan editor, room contents, toolbar
- `src/lib` – geometry helpers, file loading
- `tests/unit` – unit tests for pure logic
