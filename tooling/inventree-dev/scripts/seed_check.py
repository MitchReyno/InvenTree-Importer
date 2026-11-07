"""Report whether the local InvenTree matches backend/config after seeding.

`invimport parameters/categories --write` exit 0 even when they report problems,
so seeding re-runs the same sync as a dry run: anything still to create or
update, or any reported problem, means the instance is incomplete.
"""

import json

from invimport.inventree.categories import sync_tree

units, templates, categories = sync_tree(None, write=False)
pending = [
    *(f"unit {item.name}" for item in units.units if item.action != "unchanged"),
    *(f"template {item.name}" for item in templates.templates if item.action != "unchanged"),
    *(
        f"category {item.pathstring}"
        for item in categories.categories
        if item.action != "unchanged"
    ),
]
problems = [*units.problems, *templates.problems, *categories.problems]
print(
    json.dumps(
        {
            "complete": not pending and not problems,
            "pending": pending,
            "problems": problems,
            "categories": len(categories.categories),
            "templates": len(templates.templates),
            "units": len(units.units),
        }
    )
)
