# Fixed-income UI snapshot

Source: saffron-finance/fixed-income, revision
`dc104999f531611f2b5b772d3b72cc3ad8c2ed23`, `apps/frontend/src`.
Only imported UI/theme modules are retained. Exact model, matcap, noise, still
and marble assets are in `public/`; brand fonts are in `src/dev/fonts`.

Mechanical standalone adaptations:
- Narrow broad component/style imports to avoid importing the whole app.
- Use the build base URL for model and marble assets.
- Extract the two private wizard typography declarations unchanged.
- Render the capacity track as a span inside native offer buttons.
- Replace production analytics with a no-op preview adapter.
- Expose a scene spin-speed setter so click acceleration does not recreate GPU
  state; retain reduced-motion, visibility pausing and static fallback.

For a fixed-income merge use the original shared components and omit this
snapshot. Source/assets retain their upstream ownership; no new license grant
is implied by this snapshot.
