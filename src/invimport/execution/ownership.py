"""Canonical local claim discovery and lifetime locks, independent of run location.

Locks exclude active writers. Persisted unresolved claims survive lock/process exit.
This is one configured user state root, not cross-host or old-binary exclusion.
"""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import os
from pathlib import Path
import sqlite3
import sys
from threading import RLock
from typing import Iterator
from urllib.parse import quote, urlsplit, urlunsplit

from .models import Target


class OwnershipError(RuntimeError):
    pass


class JournalError(RuntimeError):
    pass


def normalize_endpoint(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    if (parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or "?" in endpoint or "#" in endpoint or "\\" in endpoint
            or "%" in parsed.path or any(p in {".", ".."} for p in parsed.path.split("/"))):
        raise ValueError("unsafe inventory endpoint")
    port = parsed.port
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    if port and port != (443 if parsed.scheme.lower() == "https" else 80):
        host += f":{port}"
    path = parsed.path.rstrip("/")
    # SDK accepts either server base or its API root; do not fold other paths.
    if not path.endswith("/api"):
        path += "/api"
    return urlunsplit((parsed.scheme.lower(), host, path + "/", "", ""))


def state_root() -> Path:
    override = os.environ.get("INVIMPORT_STATE_DIR")
    if override:
        root = Path(override)
        if not root.is_absolute():
            raise ValueError("INVIMPORT_STATE_DIR must be absolute")
        return root
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "inventree-importer"
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    if not base.is_absolute():
        raise ValueError("platform state directory must be absolute")
    return base / "inventree-importer"


def private_directory(path: Path) -> None:
    if path.is_symlink():
        raise JournalError("state directory must not be a symlink")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)


class FileLock:
    """Own one nonblocking OS lock until close, including exceptional exits."""
    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def __enter__(self) -> FileLock:
        if self.path.is_symlink():
            raise OwnershipError("lock must not be a symlink")
        self.handle = self.path.open("a+b")
        self.path.chmod(0o600)
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.write(b"0")
                self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.handle.close()
            self.handle = None
            raise OwnershipError("another writer owns this import or journal") from exc
        return self

    def __exit__(self, *args) -> None:
        if self.handle is not None:
            self.handle.close()
            self.handle = None


_process_writer = RLock()
_import_active = False


@contextmanager
def process_writer() -> Iterator[None]:
    """Exclude import overlap while allowing an enclosing caller ledger scope."""
    global _import_active
    if not _process_writer.acquire(blocking=False):
        raise OwnershipError("another import owns the process ledger")
    if _import_active:
        _process_writer.release()
        raise OwnershipError("another import owns the process ledger")
    _import_active = True
    try:
        yield
    finally:
        _import_active = False
        _process_writer.release()


@contextmanager
def ledger_recording_scope() -> Iterator[None]:
    """Keep nested caller/import recording, exclude other threads' ledgers."""
    if not _process_writer.acquire(blocking=False):
        raise OwnershipError("another import owns the process ledger")
    try:
        yield
    finally:
        _process_writer.release()


def open_database(path: Path, *, create: bool) -> sqlite3.Connection:
    if path.is_symlink() or (not create and not path.is_file()):
        raise JournalError("journal missing or unsafe; operator recovery required")
    connection = None
    try:
        connection = sqlite3.connect(f"file:{quote(path.as_posix())}?mode={'rwc' if create else 'rw'}", uri=True)
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA foreign_keys=ON")
        if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise JournalError("journal integrity check failed")
        path.chmod(0o600)
        return connection
    except (sqlite3.Error, OSError, JournalError) as exc:
        if connection is not None:
            connection.close()
        raise JournalError("journal unavailable; operator recovery required") from exc


class Registry:
    """Own the canonical registry connection; all mutations use the registry lock."""
    def __init__(self):
        self.directory = state_root() / "execution"
        private_directory(self.directory)
        self.path = self.directory / "registry.sqlite3"
        # A permanent marker makes deletion of a previously initialized registry
        # fail closed rather than silently treating unresolved imports as fresh.
        marker = self.directory / "registry.initialized"
        with FileLock(self.directory / "registry.lock"):
            if marker.exists() and not self.path.is_file():
                raise JournalError("canonical registry missing; operator recovery required")
            existed = self.path.exists()
            self.connection = open_database(self.path, create=not existed)
            version = self.connection.execute("PRAGMA user_version").fetchone()[0]
            if existed and version != 1:
                self.connection.close()
                raise JournalError("unsupported registry schema")
            if not existed:
                with self.connection:
                    self.connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE targets(endpoint TEXT PRIMARY KEY, identity TEXT NOT NULL);
                    CREATE TABLE claims(identity TEXT, import_id TEXT, run_id TEXT NOT NULL,
                        location TEXT NOT NULL, revision TEXT NOT NULL, state TEXT NOT NULL,
                        PRIMARY KEY(identity, import_id));
                    CREATE TABLE runs(run_id TEXT PRIMARY KEY, location TEXT NOT NULL,
                        revision TEXT NOT NULL, state TEXT NOT NULL);
                    CREATE TABLE audit(sequence INTEGER PRIMARY KEY, action TEXT NOT NULL,
                        run_id TEXT NOT NULL, evidence TEXT NOT NULL);
                    PRAGMA user_version=1;
                    """)
            marker.touch(mode=0o600, exist_ok=True)
            self.file_identity = self.path.stat().st_dev, self.path.stat().st_ino

    def close(self) -> None:
        self.connection.close()

    def identity(self, target: Target) -> str:
        endpoint = normalize_endpoint(target.endpoint)
        row = self.connection.execute("SELECT identity FROM targets WHERE endpoint=?", (endpoint,)).fetchone()
        proposed = "instance:" + target.instance_id if target.instance_id and target.identity_evidence else endpoint
        if row:
            if proposed.startswith("instance:") and row[0] != proposed:
                raise OwnershipError("target identity changed; reviewed association required")
            return row[0]
        return proposed

    def register_alias(self, target: Target, alias: str, *, evidence: str) -> None:
        """Explicit operator-reviewed association; never infer host equivalence."""
        if not evidence:
            raise ValueError("review evidence required")
        identity = self.identity(target)
        alias = normalize_endpoint(alias)
        with FileLock(self.directory / "registry.lock"), self.connection:
            existing = self.connection.execute("SELECT identity FROM targets WHERE endpoint=?", (alias,)).fetchone()
            if existing and existing[0] != identity:
                raise OwnershipError("alias already belongs to another target")
            claims = self.connection.execute("SELECT 1 FROM claims WHERE identity=? AND state!='complete'", (alias,)).fetchone()
            if claims and alias != identity:
                raise OwnershipError("alias has unresolved claims; reviewed migration required")
            self.connection.execute("INSERT OR IGNORE INTO targets VALUES (?,?)", (alias, identity))
            self.connection.execute("INSERT INTO audit(action,run_id,evidence) VALUES ('alias','',?)", (evidence,))

    @contextmanager
    def writer(self, target: Target, import_id: str, *, run_id: str, revision: str,
               location: Path, resume: bool = False) -> Iterator[None]:
        with process_writer():
            with self._claim_writer(target, import_id, run_id=run_id, revision=revision,
                                    location=location, resume=resume):
                yield

    @contextmanager
    def _claim_writer(self, target: Target, import_id: str, *, run_id: str, revision: str,
               location: Path, resume: bool = False) -> Iterator[None]:
        # Bind the endpoint under the canonical lock before choosing a claim
        # namespace. A concurrent legacy writer must see the same verified ID.
        with FileLock(self.directory / "registry.lock"), self.connection:
            identity = self.identity(target)
            self.connection.execute("INSERT OR IGNORE INTO targets VALUES (?,?)", (normalize_endpoint(target.endpoint), identity))
        key = sha256((identity + "\0" + import_id).encode()).hexdigest()
        with FileLock(self.directory / f"claim-{key}.lock"):
            with FileLock(self.directory / "registry.lock"), self.connection:
                row = self.connection.execute("SELECT run_id,location,revision,state FROM claims WHERE identity=? AND import_id=?", (identity, import_id)).fetchone()
                if row and row[3] != "complete":
                    if not resume or row[:3] != (run_id, str(location.resolve()), revision):
                        raise OwnershipError("unresolved import claim requires reconciliation")
                    if not location.is_file():
                        raise JournalError("claimed run journal missing; recovery required")
                elif resume:
                    raise OwnershipError("no matching unresolved run claim")
                self.connection.execute("INSERT OR IGNORE INTO targets VALUES (?,?)", (normalize_endpoint(target.endpoint), identity))
                if not resume:
                    self.connection.execute("INSERT OR REPLACE INTO claims VALUES (?,?,?,?,?,?)", (identity, import_id, run_id, str(location.resolve()), revision, "reserved"))
                self.connection.execute("INSERT OR IGNORE INTO runs VALUES (?,?,?,?)", (run_id, str(location.resolve()), revision, "reserved"))
                self.connection.execute("INSERT INTO audit(action,run_id,evidence) VALUES ('claim',?,'')", (run_id,))
            yield

    def activate(self, run_id: str, *, location: Path, revision: str) -> None:
        """Link a verified initialized run before permitting any dispatch."""
        with FileLock(self.directory / "registry.lock"), self.connection:
            row = self.connection.execute("SELECT location,revision,state FROM claims WHERE run_id=?", (run_id,)).fetchone()
            if row is None or row[:2] != (str(location.resolve()), revision) or row[2] not in {"reserved", "active"}:
                raise OwnershipError("run claim cannot be activated")
            self.connection.execute("UPDATE claims SET state='active' WHERE run_id=?", (run_id,))
            self.connection.execute("UPDATE runs SET state='active' WHERE run_id=?", (run_id,))

    def check_ownership(self, run_id: str, *, location: Path, revision: str) -> None:
        try:
            identity = self.path.stat().st_dev, self.path.stat().st_ino
            if identity != self.file_identity:
                raise JournalError("canonical registry replaced during execution")
            row = self.connection.execute("SELECT location,revision,state FROM claims WHERE run_id=?", (run_id,)).fetchone()
            if row != (str(location.resolve()), revision, "active"):
                raise OwnershipError("active run ownership unavailable")
        except (sqlite3.Error, OSError) as exc:
            raise JournalError("canonical ownership unavailable; mutations stopped") from exc

    def locate(self, run_id: str) -> tuple[Path, str]:
        row = self.connection.execute("SELECT location,revision FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise OwnershipError("unknown local run")
        path = Path(row[0])
        if not path.is_file() or path.is_symlink():
            raise JournalError("registered run missing; operator recovery required")
        return path, row[1]

    def complete(self, run_id: str) -> None:
        with FileLock(self.directory / "registry.lock"), self.connection:
            self.connection.execute("UPDATE claims SET state='complete' WHERE run_id=?", (run_id,))
            self.connection.execute("UPDATE runs SET state='complete' WHERE run_id=?", (run_id,))
            self.connection.execute("INSERT INTO audit(action,run_id,evidence) VALUES ('complete',?,'')", (run_id,))

    def abandon(self, run_id: str, *, evidence: str) -> None:
        """Retain a blocking tombstone. Disposition never authorizes blind replay."""
        if not evidence:
            raise ValueError("review evidence required")
        with FileLock(self.directory / "registry.lock"), self.connection:
            self.connection.execute("UPDATE claims SET state='abandoned' WHERE run_id=? AND state!='complete'", (run_id,))
            self.connection.execute("UPDATE runs SET state='abandoned' WHERE run_id=? AND state!='complete'", (run_id,))
            self.connection.execute("INSERT INTO audit(action,run_id,evidence) VALUES ('abandon',?,?)", (run_id, evidence))


@contextmanager
def legacy_write_guard(target: Target, import_id: str) -> Iterator[None]:
    """Legacy success releases ownership; interrupted writes retain reservations.

    This is an exclusion guard, not durable legacy recovery or a saved-PK store.
    """
    from uuid import uuid4
    registry = Registry()
    run_id = "legacy-" + uuid4().hex
    try:
        with registry.writer(target, import_id, run_id=run_id, revision="legacy",
                             location=registry.directory / "legacy-unrecoverable"):
            yield
            registry.complete(run_id)
    finally:
        registry.close()


@contextmanager
def legacy_write_guards(target: Target, import_ids: tuple[str, ...]) -> Iterator[None]:
    """Hold all selected legacy order claims under one serial process owner.

    Scope acquisition precedes all remote work. Known acquisition failure can
    close newly reserved no-dispatch claims; failures after yielding retain them.
    Existing unresolved claims are never completed or changed by that cleanup.
    """
    from contextlib import ExitStack
    from uuid import uuid4
    registry = Registry()
    acquired = []
    try:
        with process_writer(), ExitStack() as stack:
            try:
                for import_id in sorted(set(import_ids)):
                    run_id = "legacy-" + uuid4().hex
                    stack.enter_context(registry._claim_writer(target, import_id, run_id=run_id,
                        revision="legacy", location=registry.directory / "legacy-unrecoverable"))
                    acquired.append(run_id)
            except BaseException:
                for run_id in acquired:
                    registry.complete(run_id)
                raise
            yield
            for run_id in acquired:
                registry.complete(run_id)
    finally:
        registry.close()
