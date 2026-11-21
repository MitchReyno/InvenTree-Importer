"""Plain flushed stderr projection of structured import observations."""
from __future__ import annotations

import sys
from typing import TextIO

from ..execution.observation import Event


class ImportProgress:
    def __init__(self, stream: TextIO | None = None):
        self.stream = stream if stream is not None else sys.stderr
        self.started = 0
        self.finished = 0

    def __call__(self, event: Event) -> None:
        if event.kind == "request_started":
            self.started += 1
            text = f"request {event.request[:8]} start {event.label}"
        elif event.kind == "request_finished":
            self.finished += 1
            status = f" HTTP {event.status}" if event.status is not None else ""
            text = (f"request {event.request[:8]} {event.outcome}{status} "
                    f"{event.elapsed_seconds:.2f}s ({self.finished}/{self.started} dispatched settled)")
        else:
            text = f"{event.kind}: {event.label} {event.outcome}".rstrip()
        print(text, file=self.stream, flush=True)
