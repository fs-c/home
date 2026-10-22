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
   - **Rectangle** (R) / **Polygon** (P): manual drawing with snapping to existing
     corners/walls, angles snapping parallel/perpendicular to existing walls,
     alignment guides and typed lengths.
   - **Split** (X): trace the whole outline first, then cut it into rooms –
     tap a wall, optionally tap inside for bends, tap the opposite wall.
   - **Select** (V): drag corners, walls or whole rooms; add/remove corners.

   On touch devices, points follow the finger and are placed when it's lifted;
   pinch to zoom, two fingers to pan.

Everything is stored in the browser (localStorage + IndexedDB for images).
Use Export/Import to back up or move data as a single JSON file.

## Sharing

**Share…** in the menu publishes the home to a Cloudflare Durable Object
(`worker/HomeRoom.ts`, SQLite-backed, which the Workers free plan includes) and
gives an invite link (`/#join=<home>.<token>`; the token never reaches the
server logs because it's in the URL fragment). Anyone with the link can view and
edit. The app stays local-first: edits apply immediately and sync over a
WebSocket when online.

- The doc is split into entities (home, floors, rooms, items) that merge
  independently, last write wins; deletes are tombstones (`src/sync`).
- Floor plan images/backdrops are *not* synced yet; they stay on the device that
  uploaded them.
- Undo can revert someone else's change, because it restores a whole snapshot.
- Import and Reset leave the shared home (on this device only).
- `pnpm dev` runs the worker locally through `@cloudflare/vite-plugin`.

## Testing

Note that the tests are purely agent-curated and might not reflect the "true" intent 
or requirements. Nothing about them is set in stone.

```sh
pnpm typecheck     # app + tests
pnpm test          # unit tests (Vitest): geometry, snapping
```

## Layout

- `src/model` – document types, persistence, undo history
- `src/sync` – wire protocol, merge engine, `useSync` hook
- `worker` – Cloudflare Worker + `HomeRoom` Durable Object
- `src/editor` – canvas (SVG), snapping
- `src/panels` – home view, plan editor, room contents, toolbar
- `src/lib` – geometry helpers, file loading
- `tests/unit` – unit tests for pure logic
