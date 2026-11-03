"""Select optional CI jobs using native Git; no API token or path-count limit."""

import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess


CHECKS = ("backend", "backend_lint", "frontend", "markdown", "workflow_sync", "intake")
MARKDOWN_SUFFIXES = {".md", ".markdown", ".mdown", ".mkdn", ".mkd", ".mkdown"}
WORKSPACE_INPUTS = {
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".node-version",
}
CONTRACT_INPUT_ROOTS = ("contracts/", "tooling/openapi-generator/")
SHARED_WORKFLOWS = (
    ".agents/skills/",
    ".claude/skills/",
    ".claude/agents/",
    ".codex/agents/",
)


def select_checks(paths: list[str] | None) -> dict[str, bool]:
    """None means an unavailable base: conservatively run every existing check."""
    selected = dict.fromkeys(CHECKS, paths is None)
    for path in paths or []:
        suffix = PurePosixPath(path).suffix.lower()
        markdown = suffix in MARKDOWN_SUFFIXES
        contract_input = not markdown and path.startswith(CONTRACT_INPUT_ROOTS)
        if not markdown and path.startswith((".github/workflows/", ".github/scripts/")):
            return dict.fromkeys(CHECKS, True)
        if (
            markdown
            or path in WORKSPACE_INPUTS
            or path.startswith(".remark")
            or path == ".gitignore"
        ):
            selected["markdown"] = True
        if not markdown and path.startswith(("backend/", "spikes/")):
            selected["backend"] = True
            selected["backend_lint"] = True
        # The backend stub reads this route contract; it is not prose documentation.
        if path == "docs/InvenTree API.yaml":
            selected["backend"] = True
        if (
            contract_input
            or (not markdown and path.startswith("frontend/"))
            or path in WORKSPACE_INPUTS
        ):
            selected["frontend"] = True
        # Shared readability configuration is consumed by both application checks.
        if not markdown and (
            path == "eslint.config.mjs"
            or path.startswith(("tooling/eslint/", "tooling/tests/readability"))
        ):
            selected["frontend"] = True
            selected["intake"] = True
        # Both browser and server consume contracts; intake-server stays independent of Python.
        if (
            contract_input
            or (not markdown and path.startswith("intake-server/"))
            or path in WORKSPACE_INPUTS
            or path == "tooling/dev.cjs"
            or path.startswith(("tooling/dev/", "tooling/tests/dev."))
        ):
            selected["intake"] = True
        if path.startswith(SHARED_WORKFLOWS):
            selected["workflow_sync"] = True
            if suffix == ".py":
                selected["backend_lint"] = True
                # Backend crop/logo tests execute skill scripts; mirror equality alone is insufficient.
                if path.startswith((".agents/skills/", ".claude/skills/")):
                    selected["backend"] = True
        # This targeted backend test also validates the root/frontend command surface.
        if path in WORKSPACE_INPUTS or path == "frontend/package.json":
            selected["workflow_sync"] = True
    return selected


def changed_paths(event_name: str, event: dict, cwd: Path) -> list[str] | None:
    """PRs use merge-base..head; pushes use before..after, including force-pushes.

    Checkout fetches full history, including the PR merge parents (also for forks).
    Missing history/merge-base falls back to all checks, never to an empty diff.
    Disabling rename detection includes both old and new paths as delete/add.
    """
    if event_name == "pull_request":
        base = event["pull_request"]["base"]["sha"]
        head = event["pull_request"]["head"]["sha"]
        merge_base = True
    elif event_name == "push":
        base, head = event["before"], event["after"]
        merge_base = False
    else:
        raise ValueError(f"Unsupported CI event: {event_name}")
    if not all(
        isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha)
        for sha in (base, head)
    ):
        raise ValueError("CI event must contain full commit SHAs")
    if "0" * 40 in (base, head):
        print("::warning::No previous commit for this event; selecting all checks")
        return None
    revisions = [f"{base}...{head}"] if merge_base else [base, head]
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--no-renames", "-z", *revisions, "--"],
            cwd=cwd,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError:
        print("::warning::Git comparison unavailable; selecting all checks")
        return None
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def main() -> None:
    event = json.loads(
        Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8")
    )
    selected = select_checks(
        changed_paths(os.environ["GITHUB_EVENT_NAME"], event, Path.cwd())
    )
    output = "".join(
        f"{name}={str(value).lower()}\n" for name, value in selected.items()
    )
    print(output, end="")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as target:
        target.write(output)


if __name__ == "__main__":
    main()
