"""Authored fault at actual post-reservation/pre-journal engine boundary only."""

import os
from pathlib import Path
import signal
import sys

import invimport.execution.executor as executor
from adapter import start_or_adopt


def die_before_journal(*_args, **_kwargs):
    os.kill(os.getpid(), signal.SIGKILL)


if __name__ == "__main__":
    executor.RunStore = die_before_journal
    start_or_adopt(Path(sys.argv[1]), sys.argv[2])
