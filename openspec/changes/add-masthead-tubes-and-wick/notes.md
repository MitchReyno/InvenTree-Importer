# Implementation notes

- 2026-11-12T01:42Z — Loose ends live in one named `hanging` layer group in the scene rather than as direct scene children, so the scene's child count stays one object per part plus the layer. The scene tests now count part objects only.
- 2026-11-12T01:42Z — The rope needed 30 constraint passes, not the 12 the canvas prototype used, to keep a 12-point rope within 1% of its length under gravity at 60 fps.
- 2026-11-12T01:42Z — Mid-implementation, Mitch asked for the more common components to appear slightly more often now that niche parts are being added. The everyday parts' weights were raised (task 5.3), widening the scope beyond the original plan's "no change to existing weights".
- 2026-11-12T01:46Z — Gates: readability, typecheck, frontend lint, frontend tests and build all pass. The root `prettier --check .` flags `tooling/deployment/guest/browser-seccomp.json`, unchanged from the base and outside this change, so it was left alone. One full-suite run timed `App.test.tsx` out at 5 s; the file passed 25/25 when rerun alone.
