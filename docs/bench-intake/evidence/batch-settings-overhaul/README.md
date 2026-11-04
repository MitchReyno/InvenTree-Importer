# Batch settings overhaul: browser qualification

Owned synthetic fixture: `frontend/tests/fixtures/capture-settings.html` renders the production `CaptureWorkspace` with in-memory settings ports (a 300 ms acknowledged save that advances the revision by one), an in-memory catalogue (Mouser Electronics, Digi-Key, two Incoming inspection drawers and a Resistor drawer) and an in-memory observe. It sends no network, inventory or provider request. Each run used a fresh owned profile; the user's normal browser profile was not used.

## Runs

| Run | Browser | Zoom (CDP `cssVisualViewport.zoom`) | CSS width |
| --- | --- | --- | --- |
| `desktop-1280` | Playwright Chromium, headless | 1 | 1280 |
| `narrow-390`, `narrow-360` | Playwright Chromium, touch enabled | 1 | 390, 360 |
| `native-zoom-200-1280`, `native-zoom-200-720` | Google Chrome `--headless=new`, profile preference `partition.default_zoom_level` (`x`) = 200% | 2 | 640, 360 |

Each run follows the same journey and records it in `browser-results.json`:

- Layout: evidence and Batch settings side by side at 1280 (evidence x16 w708, settings x740 w524); one column at 640 and below, with settings full width. No Physical lots or Part proposals headings. Zero document horizontal overflow before and after edits.
- Autosave: typing in Batch title produced an acknowledged save (`Batch settings: Saved · revision 2`) while the same title node kept focus.
- Fuzzy supplier: typing `Mousr` offered `Mouser Electronics · #7` first with a react-select live announcement; Enter selected it, and the observed choice autosaved as revision 3.
- Default location: `Incomming` offered both drawers with distinguishing paths and IDs, then New location; Escape closed the menu and kept focus in the input.
- Purchase order: the Create a purchase order checkbox and the previewed Order number popover trigger are disabled; the preview disclosure itself works.
- New supplier draft: keyboard focus on Find automatically shows the coming-soon tooltip; its checkbox is disabled.
- Shared part tags: Enter added a `bench` chip.

Screenshots: `<run>-initial.png` (first viewport) and `<run>-edited.png` (after the journey; full page at native zoom 1, viewport at native zoom 2). Native-zoom screenshots use CDP `Page.captureScreenshot`, because Playwright clips captures to CSS pixels under native zoom.

Found and fixed during qualification: the settings panel kept its own `grid-area`, which placed it in an implicit narrow column inside the settings column below 860px (about 200px wide at 390px, and horizontal overflow at 360px after edits).

Limits: the fixture proves layout, focus, keyboard and autosave mechanics against owned fakes, not a real target or server. Conflict, unconfirmed, disconnect and instruction cases are covered by the component and App tests.
