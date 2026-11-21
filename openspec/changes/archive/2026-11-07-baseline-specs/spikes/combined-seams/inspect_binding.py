"""Read-only public canonical binding inspection in the owned state environment."""

import json
from pathlib import Path
import sys

from adapter import load_intent
from invimport.execution.adoption import inspect_binding


if __name__ == "__main__":
    plan, directory = load_intent(Path(sys.argv[1]), sys.argv[2])
    binding = inspect_binding(plan, directory)
    print(json.dumps(None if binding is None else {
        "run_id": binding.run_id, "state": binding.state, "snapshot": binding.snapshot,
    }))
