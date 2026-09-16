# Browser resource lifecycle — 0.8.28

Reviewed the application-owned browser routines for timers, polling overlap,
subscriptions, React effect dependencies, SSE readers, retained collections,
animation frames, and WebGL disposal. This is not a certification of every
third-party dependency or a diagnosis of a particular device's browser crash.

## Corrections

- A denied WebGL context previously left Three's Timer connected to document.
  It now connects only after successful scene construction. Failed/cancelled
  setup releases owned assets, including those that arrive after cancellation.
  Setup has a 15-second deadline; replaced GLTF materials are disposed too.
- A renderer exception must not repeat every animation frame. The animation
  loop now stops and releases the scene on failure, preserving the still logo.
- SSE comments reset the wire-byte counter without releasing accumulated data
  lines. The parser now independently bounds retained data, event type, ID and
  incomplete line to 16,384 UTF-16 characters. Existing byte/payload limits remain.
- Control-response size checks previously happened after buffering the entire
  body. Incremental reads now cancel above 32,768 bytes and on owner cancellation.

## Checks

The unit suite includes WebGL failure/cancelled-loading resource ownership,
comment-interleaved oversized SSE messages, JSON early cancellation, split
UTF-8, route release, StrictMode ownership, bfcache resume, and HTTP failure /
expiry semantics. The full 159-test suite and normal/lab builds passed.

Compiled-browser checks exercised 40 modal openings with WebGL available and
40 with WebGL denied. No page errors or accumulation of logo contexts/listeners
was observed. GPU-unavailable fallback remains usable. Small initial JIT/cache
growth is distinct from an indefinitely growing retained object graph.

Polling remains serialized with existing cleanup/backoff. Catalog updates and
history replace bounded snapshots rather than append a browser-side history.
No wallet signing, transaction recovery, service-control, or accounting rules
were weakened. Reproduction fixtures do not submit live transactions.

A finite test cannot rule out every future leak, GPU-driver failure, extension
interaction, or OS memory-pressure crash. Reload existing tabs to adopt a newly
deployed JavaScript bundle; hot-publishing assets does not replace running code.
