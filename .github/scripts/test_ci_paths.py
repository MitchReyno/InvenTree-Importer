"""Executable CI selection regressions; only Python's standard library and Git."""

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

from ci_paths import CHECKS, changed_paths, select_checks


class SelectionTests(unittest.TestCase):
    def assert_checks(self, paths, *expected):
        self.assertEqual(
            {name for name, selected in select_checks(paths).items() if selected},
            set(expected),
        )

    def test_documentation_does_not_run_application_suites(self):
        for path in (
            "README.md",
            "docs/intake-plan.md",
            "backend/README.md",
            "frontend/ARCHITECTURE.md",
            "intake-server/TESTING.md",
            "contracts/README.md",
            "spikes/shared/README.md",
            ".github/scripts/README.md",
            ".github/workflows/README.md",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "markdown")

    def test_backend_and_frontend_are_asymmetric(self):
        for path in (
            "backend/src/invimport/cli.py",
            "backend/tests/test_config.py",
            "backend/uv.lock",
            "backend/.python-version",
            "backend/pyproject.toml",
            "spikes/shared/schemas/message.schema.json",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "backend", "backend_lint")
        self.assert_checks(["backend/config/units.yaml"], "backend", "backend_lint", "intake")
        for path in (
            "frontend/src/App.tsx",
            "frontend/vite.config.ts",
            "frontend/tsconfig.json",
            "frontend/eslint.config.js",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "frontend")

    def test_local_inventree_tooling_selects_intake_and_lints_its_python(self):
        for path in (
            "tooling/inventree-dev/cli.cjs",
            "tooling/inventree-dev/compose.yaml",
            "tooling/inventree-dev/seed/fixtures.json",
            "tooling/tests/inventree-dev.test.cjs",
            "tooling/tests/inventree-dev-seed.test.cjs",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "intake")
        self.assert_checks(
            ["tooling/inventree-dev/scripts/bootstrap.py"], "intake", "backend_lint"
        )
        self.assert_checks(["tooling/inventree-dev/README.md"], "markdown")

    def test_openspec_overlap_tooling_selects_its_node_tests(self):
        for path in ("tooling/openspec/overlap.mjs", "tooling/tests/openspec-overlap.test.mjs"):
            with self.subTest(path=path):
                self.assert_checks([path], "intake")

    def test_intake_and_browser_select_actual_contract_consumers_not_python(self):
        for path in (
            "intake-server/src/api/server.ts",
            "intake-server/package.json",
            "intake-server/tsconfig.json",
            "intake-server/migrations/0001_foundation.sql",
            "intake-server/scripts/dev-services.cjs",
            "intake-server/tests/support/database.ts",
            "tooling/dev.cjs",
            "tooling/dev/process.cjs",
            "tooling/tests/dev.test.cjs",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "intake")
        for path in (
            "contracts/package.json",
            "contracts/tsconfig.json",
            "contracts/src/index.ts",
            "contracts/generated/api.d.ts",
            "contracts/generated/client.ts",
            "contracts/generated/openapi.json",
            "contracts/vectors/canonical-v1.json",
            "contracts/scripts/generate.cjs",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "intake", "frontend")
        self.assert_checks(
            ["intake-server-other/foo.ts", "contracts-other/schema.json"]
        )
        self.assert_checks(
            ["intake-server/src/config.ts", "frontend/src/App.tsx"],
            "intake",
            "frontend",
        )

    def test_shared_readability_tools_select_both_typescript_consumers(self):
        for path in (
            "eslint.config.mjs",
            "tooling/eslint/readability.mjs",
            "tooling/tests/readability.test.mjs",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "frontend", "intake")
        self.assert_checks(["tooling/unrelated.cjs"])
        self.assert_checks(["tooling/eslint/README.md"], "markdown")

    def test_unused_code_tooling_selects_both_typescript_consumers(self):
        for path in (
            "knip.json",
            "tooling/unused-code/check.mjs",
            "tooling/unused-code/baseline.json",
            "tooling/tests/unused-code.test.mjs",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "frontend", "intake")

    def test_openapi_generator_inputs_select_contract_consumers(self):
        for path in (
            "tooling/openapi-generator/index.cjs",
            "tooling/openapi-generator/package.json",
            "tooling/openapi-generator/tsconfig.json",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "frontend", "intake")
        for path in (
            "tooling/openapi-generator/README.md",
            "tooling/openapi-generator/CHANGELOG.markdown",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "markdown")
        self.assert_checks(
            ["tooling/openapi-generator-other/index.cjs", "tooling/unrelated/index.cjs"]
        )

    def test_shared_skills_agents_and_resources_need_sync_not_full_tests(self):
        for path in (
            ".agents/skills/crop/reference.png",
            ".claude/skills/crop/reference.json",
            ".codex/agents/component-researcher.toml",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], "workflow_sync")
        self.assert_checks(
            [".claude/agents/component-researcher.md"], "workflow_sync", "markdown"
        )
        self.assert_checks(
            [".agents/skills/crop/SKILL.md"], "workflow_sync", "markdown"
        )

    def test_either_skill_python_mirror_selects_behavioral_backend_tests(self):
        for root in (".agents/skills", ".claude/skills"):
            for script in (
                "component-photo-crops/scripts/crop.py",
                "company-logos/scripts/scan_logo.py",
            ):
                with self.subTest(root=root, script=script):
                    # Each mirror alone must select the consumers, not only a paired change.
                    self.assert_checks(
                        [f"{root}/{script}"], "backend", "backend_lint", "workflow_sync"
                    )

    def test_api_spec_is_a_backend_test_input_not_ordinary_documentation(self):
        self.assert_checks(["docs/InvenTree API.yaml"], "backend")
        self.assert_checks(["docs/unrelated.yaml"])

    def test_manifests_and_tool_configuration(self):
        for path in (
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
            ".node-version",
        ):
            with self.subTest(path=path):
                self.assert_checks(
                    [path], "frontend", "intake", "markdown", "workflow_sync"
                )
        self.assert_checks(["frontend/package.json"], "frontend", "workflow_sync")
        self.assert_checks([".remarkrc.json", ".gitignore"], "markdown")

    def test_ci_changes_validate_all_jobs(self):
        for path in (
            ".github/workflows/ci.yml",
            ".github/workflows/test.yml",
            ".github/workflows/lint.yml",
            ".github/scripts/ci_paths.py",
            ".github/scripts/test_ci_paths.py",
        ):
            with self.subTest(path=path):
                self.assert_checks([path], *CHECKS)

    def test_empty_unrelated_mixed_and_unavailable(self):
        self.assert_checks([])
        self.assert_checks(
            ["LICENSE", ".github/ISSUE_TEMPLATE/bug.yml", "frontend-other/file.ts"]
        )
        self.assert_checks(
            ["frontend/src/App.tsx", "docs/design.md"], "frontend", "markdown"
        )
        self.assert_checks(
            ["backend/config/units.yaml", "frontend/src/App.tsx"],
            "backend",
            "backend_lint",
            "frontend",
            "intake",
        )
        self.assert_checks(None, *CHECKS)


class GitComparisonTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "-q", "-b", "base")
        self.git("config", "user.email", "ci-test@example.invalid")
        self.git("config", "user.name", "CI filter tests")
        self.write("README.md", "initial\n")
        self.initial = self.commit()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.root, check=True, capture_output=True, text=True
        ).stdout.strip()

    def write(self, name, body):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "test change")
        return self.git("rev-parse", "HEAD")

    def push_event(self, base, head):
        return {"before": base, "after": head}

    def pr_event(self, base, head):
        return {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}

    def test_pr_merge_base_excludes_new_base_only_files(self):
        self.git("checkout", "-qb", "fork-head")
        self.write("frontend/src/App.tsx", "fork change\n")
        head = self.commit()
        self.git("checkout", "base")
        self.write("backend/src/base_only.py", "base change\n")
        base = self.commit()
        paths = changed_paths("pull_request", self.pr_event(base, head), self.root)
        self.assertEqual(paths, ["frontend/src/App.tsx"])
        self.assertTrue(select_checks(paths)["frontend"])
        self.assertFalse(select_checks(paths)["backend"])
        # Pushes compare actual endpoints, not the PR merge base.
        self.assertEqual(
            set(changed_paths("push", self.push_event(base, head), self.root)),
            {"backend/src/base_only.py", "frontend/src/App.tsx"},
        )

    def test_push_spans_all_commits_and_detects_deletions(self):
        self.write("backend/config/units.yaml", "units: []\n")
        self.commit()
        (self.root / "README.md").unlink()
        head = self.commit()
        paths = changed_paths("push", self.push_event(self.initial, head), self.root)
        self.assertEqual(set(paths), {"README.md", "backend/config/units.yaml"})
        self.assertTrue(select_checks(paths)["backend"])
        self.assertTrue(select_checks(paths)["markdown"])

    def test_more_than_300_files_are_not_truncated(self):
        for index in range(350):
            self.write(f"docs/file-{index}.md", "documentation\n")
        self.write("frontend/src/App.tsx", "last relevant path\n")
        head = self.commit()
        paths = changed_paths(
            "pull_request", self.pr_event(self.initial, head), self.root
        )
        self.assertEqual(len(paths), 351)
        self.assertTrue(select_checks(paths)["frontend"])
        self.assertFalse(select_checks(paths)["backend"])

    def test_api_spec_deletion_and_rename_retain_backend_ownership(self):
        spec = "docs/InvenTree API.yaml"
        archived = "docs/archived-api.yaml"
        for operation in ("delete", "rename"):
            with self.subTest(operation=operation):
                self.write(spec, "paths: {}\n")
                base = self.commit()
                if operation == "delete":
                    (self.root / spec).unlink()
                else:
                    self.git("mv", spec, archived)
                head = self.commit()
                for event_name, event in (
                    ("push", self.push_event(base, head)),
                    ("pull_request", self.pr_event(base, head)),
                ):
                    paths = changed_paths(event_name, event, self.root)
                    self.assertEqual(
                        set(paths),
                        {spec} if operation == "delete" else {spec, archived},
                    )
                    self.assertEqual(
                        {
                            name
                            for name, selected in select_checks(paths).items()
                            if selected
                        },
                        {"backend"},
                    )

    def test_contract_move_and_server_deletion_select_actual_consumers(self):
        self.write("contracts/src/example.ts", "export const example = 'fixture'\n")
        base = self.commit()
        (self.root / "frontend").mkdir()
        self.git("mv", "contracts/src/example.ts", "frontend/example.ts")
        moved = self.commit()
        paths = changed_paths("pull_request", self.pr_event(base, moved), self.root)
        self.assertEqual(
            {name for name, selected in select_checks(paths).items() if selected},
            {"frontend", "intake"},
        )
        self.write("intake-server/migrations/fixture.sql", "SELECT 1;\n")
        base = self.commit()
        (self.root / "intake-server/migrations/fixture.sql").unlink()
        deleted = self.commit()
        paths = changed_paths("push", self.push_event(base, deleted), self.root)
        self.assertEqual(
            {name for name, selected in select_checks(paths).items() if selected},
            {"intake"},
        )

    def test_generator_deletion_and_move_retain_contract_consumers(self):
        generator = "tooling/openapi-generator/index.cjs"
        archived = "tooling/archived-generator.cjs"
        for operation in ("delete", "rename"):
            with self.subTest(operation=operation):
                self.write(generator, "module.exports = 'fixture'\n")
                base = self.commit()
                if operation == "delete":
                    (self.root / generator).unlink()
                else:
                    self.git("mv", generator, archived)
                head = self.commit()
                for event_name, event in (
                    ("push", self.push_event(base, head)),
                    ("pull_request", self.pr_event(base, head)),
                ):
                    paths = changed_paths(event_name, event, self.root)
                    self.assertEqual(
                        set(paths),
                        {generator} if operation == "delete" else {generator, archived},
                    )
                    self.assertEqual(
                        {
                            name
                            for name, selected in select_checks(paths).items()
                            if selected
                        },
                        {"frontend", "intake"},
                    )

    def test_rename_uses_old_and_new_paths_with_unusual_names(self):
        old = "backend/config/odd\nname.yaml"
        new = "docs/renamed file.md"
        self.write(old, "retained content\n")
        base = self.commit()
        (self.root / new).parent.mkdir()
        self.git("mv", old, new)
        head = self.commit()
        paths = changed_paths("push", self.push_event(base, head), self.root)
        self.assertEqual(set(paths), {old, new})
        self.assertTrue(select_checks(paths)["backend"])
        self.assertTrue(select_checks(paths)["markdown"])
        # Also test a PR moving a file into an application from unrelated docs.
        (self.root / "frontend").mkdir()
        self.git("mv", new, "frontend/renamed.ts")
        renamed = self.commit()
        paths = changed_paths("pull_request", self.pr_event(head, renamed), self.root)
        self.assertEqual(set(paths), {new, "frontend/renamed.ts"})
        self.assertTrue(select_checks(paths)["frontend"])
        self.assertTrue(select_checks(paths)["markdown"])
        self.assertFalse(select_checks(paths)["backend"])

    def test_no_changes_new_branch_missing_history_and_missing_merge_base(self):
        self.assertEqual(
            changed_paths(
                "push", self.push_event(self.initial, self.initial), self.root
            ),
            [],
        )
        with redirect_stdout(io.StringIO()):
            self.assertIsNone(
                changed_paths(
                    "push", self.push_event("0" * 40, self.initial), self.root
                )
            )
            self.assertIsNone(
                changed_paths(
                    "push", self.push_event("a" * 40, self.initial), self.root
                )
            )
        self.git("checkout", "--orphan", "unrelated")
        self.git("rm", "-rf", ".")
        self.write("other.txt", "unrelated history\n")
        head = self.commit()
        with redirect_stdout(io.StringIO()):
            self.assertIsNone(
                changed_paths(
                    "pull_request", self.pr_event(self.initial, head), self.root
                )
            )

    def test_invalid_event_or_revision_fails_instead_of_skipping(self):
        with self.assertRaises(ValueError):
            changed_paths("pull_request_target", {}, self.root)
        with self.assertRaises(ValueError):
            changed_paths("push", self.push_event("--help", self.initial), self.root)

    def test_event_file_to_github_outputs(self):
        self.write("frontend/src/App.tsx", "change\n")
        head = self.commit()
        event = self.root / "event.json"
        event.write_text(
            json.dumps(self.pr_event(self.initial, head)), encoding="utf-8"
        )
        output = self.root / "outputs"
        subprocess.run(
            ["python3", str(Path(__file__).with_name("ci_paths.py"))],
            cwd=self.root,
            check=True,
            env=os.environ
            | {
                "GITHUB_EVENT_PATH": str(event),
                "GITHUB_EVENT_NAME": "pull_request",
                "GITHUB_OUTPUT": str(output),
            },
            capture_output=True,
        )
        self.assertEqual(
            output.read_text().splitlines(),
            [
                "backend=false",
                "backend_lint=false",
                "frontend=true",
                "markdown=false",
                "workflow_sync=false",
                "intake=false",
            ],
        )


if __name__ == "__main__":
    unittest.main()
