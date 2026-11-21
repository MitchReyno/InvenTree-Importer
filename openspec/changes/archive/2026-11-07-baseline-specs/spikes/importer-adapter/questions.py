"""Persist synchronous planning decisions, never park an importer slot."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from invimport.demo.workspace import save_json
from invimport.execution.models import canonical
from invimport.execution.ownership import FileLock


class WaitingForAnswer(Exception):
    pass


class Questions:
    """Trusted spike boundary; callers authenticate actors before answer()."""

    def __init__(self, directory: Path, context: dict, *, planning_revision: str = ""):
        self.directory = directory
        self.context = context
        self.planning_revision = planning_revision
        directory.mkdir(exist_ok=True)

    def choose(self, subject: str, offered: dict[str, object], scopes: list[str], *, kind: str) -> object:
        from adapter import read_json, validate_message
        identities = {key: vars(value) if hasattr(value, "__dict__") else value for key, value in offered.items()}
        fingerprint = sha256(canonical([self.context, self.planning_revision, subject, scopes, identities]).encode()).hexdigest()
        key = "q-" + fingerprint[:32]
        path = self.directory / (key + ".json")
        if not path.exists():
            sequence = 1 + max((read_json(p)["question"]["sequence"] for p in self.directory.glob("*.json")
                                if all(read_json(p)["question"].get(k) == v for k, v in self.context.items())), default=0)
            question = {**self.context, "type": "job.question", "sequence": sequence,
                        "question_id": key, "question_revision": 1, "kind": kind,
                        "scope_ids": scopes, "prompt": subject + "; choose " + ", ".join(offered)}
            validate_message(question)
            save_json(path, {"question": question, "offered": sorted(offered), "answer": None})
        record = read_json(path)
        answer = record["answer"]
        if answer is None:
            raise WaitingForAnswer(key)
        return offered[answer["value"]]

    def answer(self, message: dict) -> None:
        from adapter import read_json, validate_message
        validate_message(message)
        if message["type"] != "job.answer":
            raise ValueError("not an answer")
        key = message["question_id"]
        path = self.directory / (key + ".json")
        with FileLock(self.directory / "answers.lock"):
            record = read_json(path)
            question = record["question"]
            if any(message.get(field) != value for field, value in self.context.items()):
                raise ValueError("obsolete question/input/attempt")
            for field in (*self.context, "question_id", "question_revision"):
                if message.get(field) != question[field]:
                    raise ValueError("obsolete question/input/attempt")
            if message["value"] not in record["offered"]:
                raise ValueError("answer is outside offered choices")
            if record["answer"] is not None and record["answer"] != message:
                raise ValueError("conflicting answer")
            save_json(path, {**record, "answer": message})
