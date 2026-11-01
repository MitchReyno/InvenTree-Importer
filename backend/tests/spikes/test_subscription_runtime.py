"""Offline regression controls; these tests never infer or access personal login."""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import runpy
import subprocess
import sys
from unittest.mock import patch

from jsonschema import Draft202012Validator
import pytest


ROOT = Path(__file__).resolve().parents[3]
SPIKE = ROOT / "spikes/subscription-runtime"
FIXTURE = ROOT / "spikes/shared/fixtures/two-lots"
spec = importlib.util.spec_from_file_location("subscription_spike_runtime", SPIKE / "runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
with patch.dict(sys.modules, {"runtime": runtime}):
    validation = runpy.run_path(str(SPIKE / "validate_proposal.py"))


@pytest.mark.parametrize("provider,account,expected", [
    ("claude", {"loggedIn": False}, "waiting_for_login"),
    ("claude", {}, "billing_mode_rejected"),
    ("claude", {"loggedIn": True, "authMethod": "apiKey"}, "billing_mode_rejected"),
    ("claude", {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro"}, "ready"),
    ("claude", {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "bedrock", "subscriptionType": "pro"}, "billing_mode_rejected"),
    ("codex", {"account": None}, "waiting_for_login"),
    ("codex", {"account": {"type": "apiKey"}}, "billing_mode_rejected"),
    ("codex", {"account": {"type": "chatgpt", "planType": "unknown"}, "requiresOpenaiAuth": True}, "billing_mode_rejected"),
    ("codex", {"account": {"type": "chatgpt", "planType": "prolite"}, "requiresOpenaiAuth": True}, "ready"),
    ("codex", {"account": {"type": "chatgpt", "planType": "prolite"}, "requiresOpenaiAuth": False}, "billing_mode_rejected"),
    ("unknown", {}, "billing_mode_rejected"),
])
def test_simulated_native_auth_modes_fail_closed(provider, account, expected):
    assert runtime.subscription_state(provider, account) == expected


@pytest.fixture
def capacity():
    return {"ordinaryUsageAllowed": True, "rateLimits": {
        "credits": {"hasCredits": False, "unlimited": False, "balance": "0"},
        "primary": {"usedPercent": 73}, "secondary": None,
        "rateLimitReachedType": None, "spendControlReached": False,
    }}


def test_simulated_known_ordinary_capacity(capacity):
    assert runtime.codex_capacity(capacity) == "ready"


@pytest.mark.parametrize("field,value", [("hasCredits", True), ("unlimited", True), ("balance", "1"), ("balance", None)])
def test_simulated_credit_fallback_rejected(capacity, field, value):
    capacity["rateLimits"]["credits"][field] = value
    assert runtime.codex_capacity(capacity) == "billing_mode_rejected"


@pytest.mark.parametrize("field,value", [("rateLimitReachedType", "usageLimit"), ("spendControlReached", True)])
def test_simulated_limits_not_inferred_from_percent(capacity, field, value):
    capacity["rateLimits"][field] = value
    assert runtime.codex_capacity(capacity) == "waiting_for_capacity"


def test_simulated_exhaustion_and_unknown_capacity(capacity):
    capacity["rateLimits"]["primary"]["usedPercent"] = 100
    assert runtime.codex_capacity(capacity) == "waiting_for_capacity"
    capacity["rateLimits"]["primary"] = None
    assert runtime.codex_capacity(capacity) == "capacity_unknown"
    capacity["ordinaryUsageAllowed"] = None
    assert runtime.codex_capacity(capacity) == "waiting_for_capacity"


@pytest.mark.parametrize("category,status", [("authentication_failed", "waiting_for_login"), ("rate_limit", "waiting_for_capacity"), ("billing_error", "failed"), ("cancelled", "interrupted"), ("unknown", "failed")])
def test_simulated_failure_categories(category, status):
    assert runtime.provider_failure(category)[0] == status


def test_api_credentials_endpoints_and_customization_are_not_forwarded():
    safe = {"HOME": "owned-home", "PATH": "owned-path"}
    unsafe = {key: "do-not-forward" for key in (
        "OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",
        "CODEX_HOME", "CLAUDE_CONFIG_DIR", "PYTHONPATH", "ANTHROPIC_PROFILE",
    )}
    assert runtime.native_environment(safe | unsafe) == safe


@pytest.mark.parametrize("source", ['{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}'])
def test_duplicate_keys_and_nonfinite_json_rejected(source):
    with pytest.raises(ValueError):
        runtime.decode_json(source)


def test_staging_has_only_original_manifest_and_verified_evidence(tmp_path):
    bundle = tmp_path / "bundle"
    manifest = runtime.stage_bundle(bundle)
    expected = {"input.json", *(entry["path"] for entry in manifest["evidence"])}
    assert {p.relative_to(bundle).as_posix() for p in bundle.rglob("*") if p.is_file()} == expected
    assert (bundle / "input.json").read_bytes() == (FIXTURE / "input.json").read_bytes()
    assert not (bundle / "expected-stock.json").exists()
    with pytest.raises(FileExistsError):
        runtime.stage_bundle(bundle)


def test_modified_evidence_symlinks_and_traversal_rejected(tmp_path):
    bundle = tmp_path / "bundle"
    manifest = runtime.stage_bundle(bundle)
    reference = manifest["evidence"][0]
    original = bundle / reference["path"]
    original.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="digest"):
        runtime.evidence_bytes(bundle, reference)
    original.unlink()
    original.symlink_to(FIXTURE / reference["path"])
    with pytest.raises(ValueError, match="symlink"):
        runtime.evidence_bytes(bundle, reference)
    for path in ("../outside", "/outside", "evidence/../../outside", "evidence\\outside"):
        with pytest.raises(ValueError):
            runtime.evidence_bytes(bundle, reference | {"path": path})


@pytest.mark.parametrize("contained", [False, True])
def test_proposal_symlinks_rejected_before_read_or_success(tmp_path, contained):
    directory = tmp_path / "run"
    bundle = directory / "bundle"
    runtime.stage_bundle(bundle)
    target = bundle / "other.json" if contained else tmp_path / "external.json"
    target.write_bytes((SPIKE / "observed/proposal.json").read_bytes())
    (bundle / "proposal.json").symlink_to(target)
    with patch("os.open", side_effect=AssertionError("proposal must not be opened")):
        with pytest.raises(ValueError, match="symlink proposal"):
            validation["accept"](directory)
    assert not (directory / "questions.sqlite3").exists()
    assert not (directory / "validation.json").exists()


def test_proposal_symlink_parent_rejected(tmp_path):
    bundle = tmp_path / "bundle"
    runtime.stage_bundle(bundle)
    (bundle / "proposal.json").write_bytes((SPIKE / "observed/proposal.json").read_bytes())
    alias = tmp_path / "alias"
    alias.symlink_to(bundle, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink proposal"):
        validation["validate_fixture_proposal"](alias / "proposal.json")


def test_importer_validation_and_digest_use_the_same_proposal_snapshot(tmp_path):
    bundle = tmp_path / "bundle"
    runtime.stage_bundle(bundle)
    proposal = bundle / "proposal.json"
    original = (SPIKE / "observed/proposal.json").read_bytes()
    proposal.write_bytes(original)
    parse_document = validation["parse_document"]

    def replace_path_then_parse(data, *, path):
        assert data == json.loads(original)
        path.write_bytes(b'{"invalid":"replacement must not be parsed or hashed"}')
        return parse_document(data, path=path)

    with patch.dict(validation["validate_fixture_proposal"].__globals__, {"parse_document": replace_path_then_parse}):
        report = validation["validate_fixture_proposal"](proposal)
    assert report["ok"]
    assert report["proposal_sha256"] == sha256(original).hexdigest()
    assert report["proposal_sha256"] != sha256(proposal.read_bytes()).hexdigest()


def shared_messages():
    return [json.loads(line) for line in (FIXTURE / "messages.jsonl").read_text(encoding="utf-8").splitlines()]


def test_durable_question_survives_real_fresh_process_and_stale_permission_does_not(tmp_path):
    store = runtime.RunStore(tmp_path / "questions.sqlite3")
    store.question(shared_messages()[2])
    epoch = store.epoch
    store.permissions.add("permission-1")
    store.close()
    code = """
import runpy, sys
from pathlib import Path
m = runpy.run_path(sys.argv[1])
s = m['RunStore'](Path(sys.argv[2]))
assert s.db.execute('SELECT count(*) FROM questions').fetchone()[0] == 1
try:
    s.deny_permission(sys.argv[3], 'permission-1')
except ValueError:
    pass
else:
    raise AssertionError('stale permission accepted')
s.close()
"""
    subprocess.run([sys.executable, "-c", code, str(SPIKE / "runtime.py"), str(tmp_path / "questions.sqlite3"), epoch], check=True, timeout=10)
    restarted = runtime.RunStore(tmp_path / "questions.sqlite3")
    try:
        answer = shared_messages()[4]
        with pytest.raises(ValueError, match="stale"):
            restarted.answer(answer | {"question_revision": 2})
        restarted.answer(answer)
        with pytest.raises(ValueError):
            restarted.answer(answer)
        assert json.loads(restarted.db.execute("SELECT answer FROM questions").fetchone()[0])["value"] == "20"
        restarted.permissions.add("fresh")
        assert restarted.deny_permission(restarted.epoch, "fresh") == {"decision": "decline"}
        with pytest.raises(ValueError):
            restarted.deny_permission(restarted.epoch, "fresh")
    finally:
        restarted.close()


def test_observed_live_messages_conform_and_keep_exact_revisions():
    schema = json.loads((ROOT / "spikes/shared/schemas/message.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    messages = [json.loads(line) for line in (SPIKE / "observed/messages.jsonl").read_text(encoding="utf-8").splitlines()]
    for message in messages:
        validator.validate(message)
    for attempt in {message["attempt_id"] for message in messages}:
        emitted = [message for message in messages if message["attempt_id"] == attempt and "sequence" in message]
        assert [message["sequence"] for message in emitted] == list(range(1, len(emitted) + 1))
    successful = [message for message in messages if message.get("status") == "succeeded"]
    assert len(successful) == 1
    assert successful[0]["output_ref"]["sha256"] == sha256((SPIKE / "observed/proposal.json").read_bytes()).hexdigest()
    assert successful[0]["input_revision"] == sha256((FIXTURE / "input-confirmed.json").read_bytes()).hexdigest()
    assert any(message.get("status") == "interrupted" for message in messages)


def test_observed_proposal_validates_with_real_importer_without_oracle(tmp_path):
    bundle = tmp_path / "bundle"
    runtime.stage_bundle(bundle)
    proposal = bundle / "proposal.json"
    proposal.write_bytes((SPIKE / "observed/proposal.json").read_bytes())
    report = validation["validate_fixture_proposal"](proposal)
    assert report["ok"]
    assert report["keys"] == ["invimport:SPIKE-TWO-LOTS-001:lot-a", "invimport:SPIKE-TWO-LOTS-001:lot-b"]
    raw = json.loads(proposal.read_text(encoding="utf-8"))
    broken = deepcopy(raw)
    broken["lines"][1]["id"] = "renumbered"
    proposal.write_text(json.dumps(broken), encoding="utf-8")
    with pytest.raises(ValueError, match="contribution"):
        validation["validate_fixture_proposal"](proposal)


def test_fixture_acceptance_requires_durable_answer_and_is_terminal(tmp_path):
    directory = tmp_path / "run"
    bundle = directory / "bundle"
    runtime.stage_bundle(bundle)
    (bundle / "proposal.json").write_bytes((SPIKE / "observed/proposal.json").read_bytes())
    (bundle / "input-confirmed.json").write_bytes((FIXTURE / "input-confirmed.json").read_bytes())
    messages = shared_messages()
    store = runtime.RunStore(directory / "questions.sqlite3")
    store.question(messages[2])
    for index in (5, 6, 7):
        store.append(messages[index])
    store.close()
    with pytest.raises(ValueError, match="missing durable"):
        validation["accept"](directory)
    store = runtime.RunStore(directory / "questions.sqlite3")
    store.answer(messages[4])
    store.close()
    assert validation["accept"](directory)["ok"]
    with pytest.raises(ValueError, match="terminal"):
        validation["accept"](directory)


@pytest.mark.parametrize("change", ["parameters", "defaults", "attachments", "manufacturer"])
def test_fixture_proposal_rejects_invented_facts_or_extra_media(tmp_path, change):
    bundle = tmp_path / "bundle"
    runtime.stage_bundle(bundle)
    raw = json.loads((SPIKE / "observed/proposal.json").read_text(encoding="utf-8"))
    if change == "parameters":
        raw["parts"][0]["parameters"]["Resistance"] = "200"
    elif change == "defaults":
        raw["defaults"]["supplier"] = "Invented"
    elif change == "attachments":
        raw["lines"][0]["attachments"] = ["../private"]
    else:
        raw["parts"][0]["manufacturer"] = "Invented"
    proposal = bundle / "proposal.json"
    proposal.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError):
        validation["validate_fixture_proposal"](proposal)
