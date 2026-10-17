"""Find the logos on the open page, and the colour each sits on.

Run inside browser-harness (its helpers - js, cdp - are pre-imported), on
the tab already showing the company's page. From the repo root:

    browser-harness <<'PY'
    import runpy
    runpy.run_path(".claude/skills/company-logos/browser-scripts/logo_bg.py",
                   init_globals={**globals(),
                                 "SAVE_DIR": ".temp/<task>/logo-bg/acme"})
    PY

Candidates are <img>, inline <svg> and CSS background images whose src, alt,
class, id, aria-label or title mention "logo", plus the image in the link to
the home page. For each it prints the source (the largest srcset entry for an
<img>), its box, and the first non-transparent computed background-color
behind it, walking up its ancestors - the colour the site shows that logo on.
A photo or gradient on the way up is reported: the colour behind it is not
what a visitor sees, so check an inner page where the header is solid.

With SAVE_DIR, each inline SVG is saved with its computed fill, stroke and
opacity written onto every shape (a header SVG often takes its colours from
CSS, and renders black on its own), and each logo's box is screenshotted at
2x as clip-<n>.png.
"""

import base64
import json
from pathlib import Path

FIND = r"""
(() => {
  // Web components (a site menu as <x-menu>) keep their logo in a shadow
  // root, which querySelectorAll does not enter; walk into each one.
  const deep = (root, sel, acc = []) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.matches(sel)) acc.push(el);
      if (el.shadowRoot) deep(el.shadowRoot, sel, acc);
    }
    return acc;
  };
  const up = n => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const isLogo = el => /logo/i.test([el.getAttribute('src'), el.getAttribute('alt'),
      el.getAttribute('class'), el.id, el.getAttribute('aria-label'),
      el.getAttribute('title'), el.getAttribute('data-src')].join(' '));
  const home = deep(document, 'a[href]').filter(a => {
      try { const u = new URL(a.href, location.href);
            return u.host === location.host && (u.pathname === '/' || u.pathname === ''); }
      catch (e) { return false; } });
  const found = new Set();
  for (const el of deep(document, 'img, svg, [style*="background"], div, a, span, i'))
    if (isLogo(el) || (el.tagName.toLowerCase() === 'svg' && isLogo(up(el) || el)))
      found.add(el);
  for (const a of home) {
    const m = a.querySelector('img, svg') || deep(a, 'img, svg')[0];
    if (m) found.add(m);
  }
  const bgImage = el => { const b = getComputedStyle(el).backgroundImage;
      return b && b !== 'none' ? b : ''; };
  const colour = el => {
    let over = '';
    for (let n = el; n && n.nodeType === 1; n = up(n)) {
      const s = getComputedStyle(n);
      if (n !== el && bgImage(n)) over = over || bgImage(n).slice(0, 200);
      const c = s.backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(Number);
        if (p.length < 4 || p[3] > 0) return {color: c, from: n.tagName.toLowerCase() +
            (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string'
            ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), over}; }
    }
    return {color: 'none (page default)', from: '', over};
  };
  const svgText = svg => {
    const copy = svg.cloneNode(true);
    const a = [svg, ...svg.querySelectorAll('*')], b = [copy, ...copy.querySelectorAll('*')];
    a.forEach((n, i) => { const s = getComputedStyle(n);
      for (const k of ['fill', 'stroke', 'opacity', 'fill-opacity', 'stroke-width'])
        if (s[k]) b[i].style.setProperty(k, s[k]); });
    if (!copy.getAttribute('xmlns')) copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return copy.outerHTML;
  };
  const out = [];
  for (const el of found) {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    // A wrapper whose class says logo is not the logo; a 16 px icon is not
    // the company's mark.
    if (tag !== 'img' && tag !== 'svg' && !bgImage(el)) continue;
    if (r.width < 24 || r.height < 12) continue;
    let src = '';
    if (tag === 'img') {
      src = el.currentSrc || el.src;
      const set = (el.srcset || '').split(',').map(x => x.trim().split(/\s+/))
        .filter(x => x[0]);
      if (set.length) { set.sort((p, q) => parseFloat(q[1] || 1) - parseFloat(p[1] || 1));
        src = new URL(set[0][0], location.href).href; }
    } else if (bgImage(el)) src = bgImage(el);
    out.push({tag, src, alt: el.getAttribute('alt') || el.getAttribute('aria-label') || '',
      box: [r.left + scrollX, r.top + scrollY, r.width, r.height].map(Math.round),
      background: colour(el), svg: tag === 'svg' ? svgText(el) : ''});
  }
  out.sort((p, q) => p.box[1] - q.box[1] || q.box[2] * q.box[3] - p.box[2] * p.box[3]);
  return JSON.stringify(out.slice(0, 12));
})()
"""

logos = json.loads(js(FIND))  # noqa: F821 - provided by browser-harness
save = Path(globals().get("SAVE_DIR") or "")
if globals().get("SAVE_DIR"):
    save.mkdir(parents=True, exist_ok=True)
print(f"{len(logos)} logo candidate(s) on {js('location.href')}")  # noqa: F821
for i, logo in enumerate(logos, start=1):
    bg = logo["background"]
    print(f"{i}. <{logo['tag']}> {logo['src'][:120] or '(inline)'}"
          f"{'  alt=' + repr(logo['alt']) if logo['alt'] else ''}")
    print(f"   box {logo['box']}  background {bg['color']}"
          f"{'  from ' + bg['from'] if bg['from'] else ''}")
    if bg["over"]:
        print(f"   ! over an image/gradient: {bg['over'][:100]} - check an "
              f"inner page with a solid header")
    if not globals().get("SAVE_DIR"):
        continue
    if logo["svg"]:
        (save / f"logo-{i}.svg").write_text(logo["svg"], encoding="utf-8")
        print(f"   saved {save / f'logo-{i}.svg'} (computed colours inlined)")
    x, y, w, h = logo["box"]
    try:
        shot = cdp("Page.captureScreenshot", format="png",  # noqa: F821
                   captureBeyondViewport=True, _response_timeout=30,
                   clip={"x": x, "y": y, "width": w, "height": h,
                         "scale": 2})
    except Exception as exc:                     # a heavy page, a hidden tab
        print(f"   no clip: {type(exc).__name__} - screenshot it by hand")
        continue
    (save / f"clip-{i}.png").write_bytes(base64.b64decode(shot["data"]))
    print(f"   clip {save / f'clip-{i}.png'}")
