"""Register a site's page scripts on the current browser-harness tab.

Run inside browser-harness (its helpers - cdp, current_tab - are pre-imported),
on the tab you will use for that site, BEFORE navigating it there. From the
repo root:

    browser-harness <<'PY'
    import runpy
    runpy.run_path(
        ".claude/skills/inventree-stock-import/browser-scripts/inject.py",
        init_globals={**globals(), "SITE": "alldatasheet"})
    PY

Every `*.js` in `browser-scripts/<SITE>/` is registered, in file-name order,
with Page.addScriptToEvaluateOnNewDocument, so it runs on every page load in
this tab from then on. Scripts registered that way run before the page's DOM
exists, so each is wrapped to wait for DOMContentLoaded - the scripts
themselves are kept exactly as written.

Registration is per tab (per CDP session): a new tab needs it again. Running
it twice on one tab registers the scripts twice; the scripts tolerate that,
but avoid it - the identifiers are printed so they can be removed with
Page.removeScriptToEvaluateOnNewDocument.
"""

from pathlib import Path

# runpy.run_path sets __file__, so the site folders are found beside this file
# wherever the repo is checked out.
HERE = Path(__file__).resolve().parent

WRAPPER = """(function () {
  const run = () => {
%s
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
"""

site = globals().get("SITE")
if not site:
    raise SystemExit("set SITE (a folder under browser-scripts/)")
scripts = sorted((HERE / site).glob("*.js"))
if not scripts:
    raise SystemExit(f"no scripts in {HERE / site}")

cdp("Page.enable")  # noqa: F821 - provided by browser-harness
for script in scripts:
    source = WRAPPER % script.read_text(encoding="utf-8")
    result = cdp("Page.addScriptToEvaluateOnNewDocument",  # noqa: F821
                 source=source)
    print(f"registered {script.name}: {result.get('identifier')}")
