#!/usr/bin/env python3
"""Reproduce synthetic read/download latency evaluation, with no network calls.

This is an experiment, never an executor setting. Each task owns its fake HTTP
boundary; the durable SQLite writer and live SDK are deliberately not shared.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
from statistics import median
import time

from invimport.execution.observation import Observation, observing, worker
from invimport.execution.transport import ObservedRequests


@dataclass
class Response:
    status_code: int = 200
    history: tuple = ()
    content: bytes = b"synthetic download bytes"


class Transport:
    def __init__(self, latency_seconds: float):
        self.latency_seconds = latency_seconds

    def get(self, url: str, **kwargs) -> Response:
        time.sleep(self.latency_seconds)
        return Response()


def sample(tasks: int, workers: int, latency_seconds: float) -> dict:
    observation = Observation()
    def request(index: int) -> int:
        # Alternate metadata-sized reads and download-shaped responses. Neither
        # exercises a real CDN, server, filesystem cache or HTTP connection pool.
        service = "synthetic read" if index % 2 == 0 else "synthetic download"
        response = ObservedRequests(observation, service=service,
                                    transport=Transport(latency_seconds)).get("https://synthetic.invalid/")
        return len(response.content)
    started = time.perf_counter()
    with observing(observation):
        if workers == 1:
            sizes = [request(index) for index in range(tasks)]
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                callback = worker(request, label="synthetic independent I/O", group="evaluation")
                sizes = list(pool.map(callback, range(tasks)))
    elapsed = time.perf_counter() - started
    return {"workers": workers, "elapsed_seconds": round(elapsed, 6), "bytes": sum(sizes),
            "requests": sum(event.kind == "request_started" for event in observation.snapshot()),
            "completed": sum(event.kind == "request_finished" for event in observation.snapshot())}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", type=int, default=24)
    parser.add_argument("--latency-seconds", type=float, default=0.01)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if args.tasks < 1 or args.repeats < 1 or args.latency_seconds < 0:
        parser.error("tasks/repeats must be positive and latency nonnegative")
    records = [sample(args.tasks, count, args.latency_seconds) for count in (1, 2, 4) for _ in range(args.repeats)]
    summaries = [{"workers": count, "median_elapsed_seconds": round(median(record["elapsed_seconds"] for record in records if record["workers"] == count), 6)} for count in (1, 2, 4)]
    print(json.dumps({"format": "invimport-synthetic-concurrency-evaluation/1", "network_calls": 0,
                      "tasks": args.tasks, "latency_seconds": args.latency_seconds, "repeats": args.repeats,
                      "samples": records, "summary": summaries, "executor_workers_enabled": 1,
                      "decision": "retain_serial_executor_pending_live_rate_client_ownership_and_resource_evidence"}, indent=2))


if __name__ == "__main__":
    main()
