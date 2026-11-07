"""Bind the isolated integration code/resolution as well as adapter's importer build."""

from coordination.boundary import canonical, sha

from .bootstrap import ROOT


def combined_build() -> str:
    here = ROOT / "spikes/combined-seams"
    files = list(here.glob("*.py")) + list((here / "seams").rglob("*.py"))
    files += [here / "pyproject.toml", here / "uv.lock"]
    files += list((ROOT / "spikes/durable-coordination/coordination").rglob("*.py"))
    files += [ROOT / "spikes/subscription-runtime" / name for name in ("runtime.py", "validate_proposal.py")]
    files += list((ROOT / "spikes/subscription-runtime/observed").glob("*.json*"))
    files += [ROOT / "spikes/shared/schemas/message.schema.json"]
    return sha(canonical([(str(path.relative_to(ROOT)), sha(path.read_bytes())) for path in sorted(files)]))
