# Batch settings placement qualification

Historical record. The fixture now serves the [batch settings overhaul qualification](../batch-settings-overhaul/README.md); the placement toggle and three-column composition described here were superseded by the two-column Capture.

Synthetic Capture fixture: `frontend/tests/fixtures/capture-settings.html`, using the production components, installed React Hook Form and one mounted form. No inventory, provider or upload clients are installed in the fixture. The placement toggle changes CSS only. Original reference files are unchanged.

## Decision

Choose a right-side settings panel on wide desktops. At1440 CSS pixels and native 100% zoom, the above-content candidate placed evidence at y1201; the right candidate placed evidence at y214 with about 635px of evidence width. Both had zero document horizontal overflow. The right panel exposes settings alongside evidence rather than requiring the operator to scroll through settings before seeing evidence. Its longer vertical form is an accepted trade-off. The above candidate remains reproducible through the fixture toggle; no production placement preference or duplicate form was introduced.

Below 1001px, the final composition reflows; below 701px, physical-lot selection, evidence and settings form one column. Both comparison candidates deliberately share this responsive composition. DOM order is queue, evidence, settings and selected editor; the narrow back action retains the focused editor route. Settings remains expanded and reachable; saved inheritance/override details start open. One draft owner survives every width/placement switch. No viewport listener conditionally mounts a form.

## Evidence

- `compare-above-desktop.png` and `compare-right-desktop.png`: same 1440px representative content and measured evidence/settings positions (`desktop-comparison.json`). The screenshots precede final DOM-order/override-expansion refinements; the candidate geometry is unchanged.
- `compare-*-narrow-360-zoom-100.png` and `compare-*-narrow-390-zoom-100.png`: native 100% zoom and exact 360/390 CSS widths; zero horizontal overflow, same input node and retained draft; disabled PO checkbox. `narrow-native-100.json` also records keyboard progression from title through quantity, location and supplier controls.
- `compare-*-zoom-200.png`, `compare-*-narrow-360.png` and `compare-*-narrow-390.png`: isolated headless Chrome with actual native page zoom 200%, verified by `Page.getLayoutMetrics` (`zoom:2`, visual viewport scale 1). CSS viewports are640/360/390 respectively. `responsive-comparison.json` records one settings panel, no overflow, unchanged input identity/text for both candidates.

Screenshots were visually inspected at desktop and 360px/200%. Headless Chrome uses an owned profile with Chromium's default-zoom preference; emulated device width sets viewport dimensions, not the zoom assertion. The user's regular browser/profile remains unchanged. These artifacts prove UI layout/focus/draft mechanics, not real inventory or provider execution. Foundation PG tests separately cover transaction/currentness behavior. Grouped evidence and the final complete Capture journey remain Tasks 4/5.

Review correction: `review-long-context-390.png` and `review-long-context-360-zoom-200.png` show an accepted 100-character unbroken tag in the same context-summary component outside a wrapping panel. Native100%/390px and native 200%/360px both have zero document horizontal overflow. The component owns `overflow-wrap:anywhere`; this also protects Review and lot editors. The fixture now includes that long retained tag and the restored note-scope selector.
