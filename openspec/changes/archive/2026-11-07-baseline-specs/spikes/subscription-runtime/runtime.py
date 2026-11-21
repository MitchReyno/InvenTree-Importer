"""Local-only investigation helpers; no web server, queue or inventory authority."""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
from typing import Mapping
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "spikes/shared/fixtures/two-lots"
CONTEXT_KEYS = ("protocol_version", "batch_id", "job_id", "attempt_id", "input_revision")


class GateBlocked(RuntimeError):
    """Controlled non-secret login/capacity/billing state for the local CLI."""


def decode_json(text: str) -> dict | list:
    def pairs(items: list[tuple]) -> dict:
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(value: str) -> None:
        raise ValueError("non-finite JSON number")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)


def native_environment(environment: Mapping[str, str]) -> dict[str, str]:
    """Do not forward API keys, tokens, endpoints, provider selectors or tool config."""
    return {key: value for key, value in environment.items() if key in {
        "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "SYSTEMROOT", "USER", "LOGNAME",
    }}


def subscription_state(provider: str, account: dict) -> str:
    """Positive native subscription identification only; unknown never means ready."""
    if provider == "claude":
        if account.get("loggedIn") is False:
            return "waiting_for_login"
        if (account.get("loggedIn") is True and account.get("authMethod") == "claude.ai"
                and account.get("apiProvider") == "firstParty"
                and account.get("subscriptionType") in {"pro", "max", "ultra", "team", "enterprise"}):
            return "ready"
    elif provider == "codex":
        if account.get("account") is None:
            return "waiting_for_login"
        if (account.get("requiresOpenaiAuth") is True
                and account["account"].get("type") == "chatgpt"
                and account["account"].get("planType") in {
                    "plus", "pro", "prolite", "team", "business", "enterprise", "edu",
                }):
            return "ready"
    return "billing_mode_rejected"


def codex_capacity(response: dict) -> str:
    """Require known ordinary capacity and no available paid credit fallback."""
    limits = response.get("rateLimits") or {}
    credits = limits.get("credits") or {}
    if (credits.get("hasCredits") is not False or credits.get("unlimited") is not False
            or credits.get("balance") not in {"0", "0.0", "0.00"}):
        return "billing_mode_rejected"
    windows = [limits.get("primary"), limits.get("secondary")]
    if (response.get("ordinaryUsageAllowed") is not True or limits.get("rateLimitReachedType")
            or limits.get("spendControlReached") is True
            or any(window and window.get("usedPercent", 100) >= 100 for window in windows)):
        return "waiting_for_capacity"
    if not any(windows):
        return "capacity_unknown"
    return "ready"


def provider_failure(category: str) -> tuple[str, str]:
    """Controlled categories, not substring guesses over secret-bearing errors."""
    return {
        "authentication_failed": ("waiting_for_login", "subscription_login_required"),
        "rate_limit": ("waiting_for_capacity", "subscription_limit_reached"),
        "billing_error": ("failed", "billing_mode_rejected"),
        "cancelled": ("interrupted", "runner_stopped"),
    }.get(category, ("failed", "provider_error"))


def evidence_bytes(base: Path, reference: dict) -> bytes:
    relative = PurePosixPath(reference["path"])
    if relative.is_absolute() or ".." in relative.parts or "\\" in str(relative):
        raise ValueError("unsafe evidence path")
    path = base / relative
    # Reject even contained symlinks: staged originals have one unambiguous owner.
    if any(parent.is_symlink() for parent in [path, *path.parents]):
        raise ValueError("symlink evidence")
    if not path.resolve().is_relative_to(base.resolve()):
        raise ValueError("escaping evidence")
    data = path.read_bytes()
    if sha256(data).hexdigest() != reference["sha256"]:
        raise ValueError("evidence digest mismatch")
    return data


def stage_bundle(destination: Path) -> dict:
    """Stage only the initial manifest and originals, NEVER the proposal oracle."""
    original = (FIXTURE / "input.json").read_bytes()
    manifest = decode_json(original.decode("utf-8"))
    assets = [(entry, evidence_bytes(FIXTURE, entry)) for entry in manifest["evidence"]]
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    (destination / "input.json").write_bytes(original)
    for reference, data in assets:
        path = destination / reference["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return manifest


class RunStore:
    """One local supervisor's durable question/events; not a dispatch scheduler.

    Each process connection gets a new epoch. Native permission IDs are ephemeral,
    never durable human questions. Restart invalidates them before any reply.
    """

    def __init__(self, path: Path) -> None:
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, answer TEXT);
        """)
        self.epoch = str(uuid4())
        self.permissions: set[str] = set()

    def close(self) -> None:
        self.permissions.clear()
        self.db.close()

    def append(self, message: dict) -> None:
        with self.db:
            self.db.execute("INSERT INTO events(payload) VALUES (?)", (json.dumps(message),))

    def question(self, message: dict) -> None:
        with self.db:
            self.db.execute("INSERT INTO questions(id,payload) VALUES (?,?)",
                            (message["question_id"], json.dumps(message)))
            self.db.execute("INSERT INTO events(payload) VALUES (?)", (json.dumps(message),))

    def answer(self, message: dict) -> None:
        row = self.db.execute("SELECT payload,answer FROM questions WHERE id=?",
                              (message["question_id"],)).fetchone()
        if row is None:
            raise ValueError("unknown question")
        question = decode_json(row[0])
        for key in (*CONTEXT_KEYS, "question_id", "question_revision"):
            if message.get(key) != question.get(key):
                raise ValueError("stale answer")
        if row[1] is not None or message.get("actor_id") != "fixture-user" or message.get("value") != "20":
            raise ValueError("invalid or already answered fixture question")
        with self.db:
            self.db.execute("UPDATE questions SET answer=? WHERE id=?",
                            (json.dumps(message), message["question_id"]))
            self.db.execute("INSERT INTO events(payload) VALUES (?)", (json.dumps(message),))

    def deny_permission(self, epoch: str, request_id: str) -> dict:
        if epoch != self.epoch or request_id not in self.permissions:
            raise ValueError("stale permission")
        self.permissions.remove(request_id)
        return {"decision": "decline"}


def claude_command() -> list[str]:
    binary = shutil.which("claude")
    if binary is None:
        raise FileNotFoundError("Claude CLI unavailable")
    return [binary, "--safe-mode", "--restricted", "--setting-sources", "",
            "--settings", '{"forceLoginMethod":"claudeai","disableAllHooks":true}',
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-chrome"]


def live_environment() -> dict[str, str]:
    return native_environment(os.environ)
