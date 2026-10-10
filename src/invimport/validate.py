"""
Check a stock file against the config, without touching InvenTree.

    from invimport.validate import validate
    report = validate(document, categories, parameters)
    if not report.ok:
        print(report.text())

stockfile.py answers "is this well-formed?". This answers "does it name things
that exist?" - categories that are in categories.yaml, parameters that are in
parameters.yaml, values those parameters can actually read.

Every problem carries a `did_you_mean` where one can be computed, because the
intended reader is often an agent iterating towards a clean file, and "unknown
category 'Resistors/SMD'" is a dead end where "did you mean
'Resistors/Surface Mount Resistors'?" is a fix.

No API calls. That is the point: an agent can loop here for free, and nothing
it gets wrong on the way can reach the database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import CategoryConfig, ParameterConfig
from .inventree.matching import candidates, match_path, ratio
from .inventree.values import (
    build_parse_registry,
    is_absent,
    read_value,
    same_dimension,
)
from .stockfile import (
    CONDITIONS,
    Problem,
    StockFile,
    StockLine,
    attribute,
    unique,
)
from .util import absolute_url


@dataclass
class Report:
    """What validation found, in a form both a person and an agent can read."""
    problems: list[Problem] = field(default_factory=list)
    warnings: list[Problem] = field(default_factory=list)
    # line id -> the parameter values that would be stored, for the preview.
    resolved: dict[str, dict[str, str]] = field(default_factory=dict)
    lines: int = 0

    @property
    def ok(self) -> bool:
        return not self.problems

    def text(self) -> str:
        out = []
        for problem in self.problems:
            out.append(f"  ERROR {problem.describe()}")
        for warning in self.warnings:
            out.append(f"  warn  {warning.describe()}")
        return "\n".join(out)

    def as_dict(self) -> dict[str, Any]:
        """
        The machine-readable form an agent loops against.

        Grouped by what is wrong: a line, or in a version 2 file a part or a
        manufacturer part - `{"part": "118a", "errors": [...]}`.
        """
        by_entry: dict[tuple[str, str], dict[str, Any]] = {}
        for bucket, found in (("errors", self.problems),
                              ("warnings", self.warnings)):
            for problem in found:
                entry = by_entry.setdefault(
                    (problem.kind, problem.line or ""),
                    {"errors": [], "warnings": []})
                entry[bucket].append(problem.as_dict())
        return {
            "ok": self.ok,
            "lines": self.lines,
            "problems": len(self.problems),
            "warnings": len(self.warnings),
            "by_line": [{kind.replace(" ", "_"): name, **detail}
                        for (kind, name), detail in sorted(
                            by_entry.items(),
                            key=lambda item: (item[0][0] != "line",
                                              item[0]))],
        }


def category_candidates(wanted: str, categories: dict[str, CategoryConfig],
                        limit: int = 3) -> list[str]:
    """
    The paths most likely meant by an unrecognised one.

    Whole-path similarity alone is a poor guide: 'Resistors/SMD' scores higher
    against 'Resistors' than against 'Resistors/Surface Mount Resistors',
    which is the answer. So when the parent exists, its children are offered -
    they are the plausible set by construction - ranked by how close the leaf
    is. Only when the parent is unrecognised too does this fall back to
    fuzzy matching over every path.
    """
    wanted = (wanted or "").strip()
    if not wanted:
        return []

    parent, _, leaf = wanted.rpartition("/")
    if parent:
        siblings = [path for path, category in categories.items()
                    if not category.structural
                    and path.rsplit("/", 1)[0].casefold() == parent.casefold()
                    and path.casefold() != wanted.casefold()]
        if siblings:
            siblings.sort(key=lambda path: (
                -ratio(leaf, path.rsplit("/", 1)[-1]), path.casefold()))
            return siblings[:limit]

    scored = [
        (path, max(ratio(wanted, path),
                   ratio(leaf or wanted, path.rsplit("/", 1)[-1])))
        for path, category in categories.items() if not category.structural
    ]
    scored.sort(key=lambda pair: (-pair[1], pair[0].casefold()))
    return [path for path, score in scored[:limit] if score > 0]


def resolve_category(line: StockLine,
                     categories: dict[str, CategoryConfig]
                     ) -> CategoryConfig | None:
    """
    The category a line names, by InvenTree path first, then by alias.

    A file names an InvenTree category directly - that is the whole point of
    writing one by hand. Falling back to alias matching means a row copied out
    of a DigiKey payload still lands somewhere sensible.
    """
    wanted = (line.category or "").strip()
    if not wanted:
        return None
    for path, category in categories.items():
        if path.casefold() == wanted.casefold():
            return category
    return match_path(wanted, categories)


def validate(
    document: StockFile,
    categories: dict[str, CategoryConfig],
    parameters: dict[str, ParameterConfig],
) -> Report:
    """Check every line against the config. Never calls the API."""
    report = Report(lines=len(document.lines))
    registry = build_parse_registry()
    paths = list(categories)

    base_dir = document.path.parent if document.path else None
    for line in document.lines:
        _check_supplier(line, report)
        _check_datasheet(line, base_dir, report)
        category = resolve_category(line, categories)

        if category is None:
            # A category the config does not have is not fatal on its own -
            # the importer can offer to create it - but the author should see
            # the near misses first, because the usual cause is a name that
            # already exists under a different spelling.
            near = category_candidates(line.category, categories)
            if line.suggest_category:
                report.warnings.append(Problem(
                    line.id, "category",
                    f"unknown category {line.category!r}; the import will "
                    f"offer to create it",
                    did_you_mean=near))
            else:
                report.problems.append(Problem(
                    line.id, "category",
                    f"unknown category {line.category!r}",
                    did_you_mean=near))
            continue

        if category.structural:
            report.problems.append(Problem(
                line.id, "category",
                f"{category.pathstring} is structural - it holds "
                f"subcategories, not parts",
                did_you_mean=[p for p in paths
                              if p.startswith(category.pathstring + "/")
                              and not categories[p].structural][:3]))
            continue

        _check_parameters(line, category, parameters, registry, report)
        _check_identity(line, category, report)
        _check_name(line, category, report)

    _check_unconfirmed_repeats(document, categories, report)
    _attribute_to_entries(document, report)
    return report


def _check_name(line: StockLine, category: CategoryConfig,
                report: Report) -> None:
    """
    A version 2 part should say what it is called.

    Only a category whose template builds the name from parameters names a
    part well by itself ('Resistor 100k 1% 0.25W Metal Film'). Anywhere else
    the fallback is the bare number - a drawing or house number such as
    '0N300704-1' says nothing about what the part is. The first line of a
    part is the one that names it, so only that line is checked.
    """
    if not line.part_ref or line.part_of or line.name:
        return
    if category.identity == "spec" and category.name_template:
        return
    designator = line.type or line.mpn
    fallback = designator or line.description[:100]
    source = ("its type" if line.type else "its MPN" if line.mpn
              else "its description")
    shown = (f"would be called {fallback!r} ({source})" if fallback
             else "has nothing to be called by")
    report.warnings.append(Problem(
        line.id, "name",
        f"no name - a new part {shown}; give it a name that says what it "
        f"is"))


def _attribute_to_entries(document: StockFile, report: Report) -> None:
    """
    In a version 2 file, a part's category or parameters are wrong once.

    Every line of the part carries a copy of them, so each copy would
    otherwise be reported against its line. Pointed at the part, the
    duplicates collapse into one problem with the place to fix it.
    """
    by_id = {line.id: line for line in document.lines if line.part_ref}
    if not by_id:
        return
    for found in (report.problems, report.warnings):
        for problem in found:
            line = by_id.get(problem.line) if problem.kind == "line" else None
            if line is not None:
                attribute([problem], line.part_ref,
                          line.manufacturer_part_ref)
    report.problems[:] = unique(report.problems)
    report.warnings[:] = unique(report.warnings)


def _check_unconfirmed_repeats(document: StockFile,
                               categories: dict[str, CategoryConfig],
                               report: Report) -> None:
    """
    Two lines naming one number that no manufacturer part will confirm.

    Under mpn identity a line with no manufacturer gets no ManufacturerPart,
    so a later line with the same mpn (or type) has nothing to find its part
    by except the name - and the import holds it for review rather than guess.
    part_of says outright that they are one part.
    """
    first: dict[tuple[str, str], str] = {}
    for line in document.lines:
        category = resolve_category(line, categories)
        if category is None or category.identity != "mpn":
            continue
        number = line.mpn or line.type
        if not number or line.manufacturer or line.ipn or line.part_of:
            continue
        key = (category.pathstring, number.strip().casefold())
        if key not in first:
            first[key] = line.id
            continue
        report.warnings.append(Problem(
            line.id, "part_of",
            f"{number!r} with no manufacturer is also on line {first[key]}; "
            f"nothing but the name would match them, so the import will hold "
            f"this line - add \"part_of\": \"{first[key]}\" if it is the same "
            f"part"))


def _check_parameters(line: StockLine, category: CategoryConfig,
                      parameters: dict[str, ParameterConfig],
                      registry, report: Report) -> None:
    """Every named parameter must exist, apply here, and be readable."""
    stored: dict[str, str] = {}
    known = list(parameters)

    for name, raw in line.parameters.items():
        parameter = parameters.get(name)
        if parameter is None:
            # Fall back to the supplier spellings, so a line may use DigiKey's
            # name for something as well as ours.
            parameter = next(
                (p for p in parameters.values()
                 if name in p.supplier_names()), None)
        if parameter is None:
            report.problems.append(Problem(
                line.id, f"parameters.{name}", "no such parameter",
                did_you_mean=_parameter_suggestions(
                    name, raw, category, parameters, registry)))
            continue

        if parameter.name not in category.parameters:
            report.warnings.append(Problem(
                line.id, f"parameters.{name}",
                f"{parameter.name!r} is not one of "
                f"{category.pathstring}'s parameters, so it will not be "
                f"stored - add it there, or run invimport discover"))
            continue

        if is_absent(raw):
            continue

        value = read_value(str(raw), parameter, registry=registry)
        if value is None:
            detail = (f"is not one of its choices "
                      f"({', '.join(parameter.choices)})"
                      if parameter.choices else
                      f"cannot be read as {parameter.units or 'a value'}")
            report.problems.append(Problem(
                line.id, f"parameters.{name}", f"{raw!r} {detail}"))
            continue
        stored[parameter.name] = value

    if stored:
        report.resolved[line.id] = stored

    # A spec category identifies its parts by key parameters, so a line that
    # supplies only some of them cannot be matched or safely created. The
    # importer will stop and ask; saying so here means the author finds out
    # before the run rather than during it.
    if category.identity == "spec" and category.key_parameters:
        missing = [name for name in category.key_parameters
                   if name not in stored]
        if missing and len(missing) < len(category.key_parameters):
            report.warnings.append(Problem(
                line.id, "parameters",
                f"{category.pathstring} identifies parts by "
                f"{', '.join(category.key_parameters)}; this line is missing "
                f"{', '.join(missing)}, so the import will ask rather than "
                f"guess"))


def _parameter_suggestions(name: str, raw: Any, category: CategoryConfig,
                           parameters: dict[str, ParameterConfig],
                           registry) -> list[str]:
    """
    What the author probably meant by an unrecognised parameter name.

    Spelling is only half of it. 'Wattage' and 'Power Rating' are the same
    quantity and share almost no letters, so fuzzy matching alone returns
    nothing useful. The value narrows it far better than the name does: if
    '0.25 W' reads as watts, the answer is whichever of this category's
    parameters is measured in watts.
    """
    known = list(parameters)
    fuzzy = [n for n, _ in candidates(name, known)][:3]

    by_unit: list[str] = []
    for candidate in category.parameters:
        parameter = parameters.get(candidate)
        if parameter is None or not parameter.units:
            continue
        if same_dimension(str(raw), parameter.units, registry):
            by_unit.append(candidate)

    # Unit matches first: they are evidence, where a name match is a guess.
    return by_unit + [name for name in fuzzy if name not in by_unit][:3]


def _check_supplier(line: StockLine, report: Report) -> None:
    """A supplier is only recorded through a SupplierPart, which needs a SKU."""
    if line.supplier and not line.sku:
        report.warnings.append(Problem(
            line.id, "sku",
            f"supplier {line.supplier!r} has no sku, so no supplier part is "
            f"created and the stock will not record where it came from - use "
            f"the seller's catalogue number, or the part number if they have "
            f"none"))


def _check_datasheet(line: StockLine, base_dir: Path | None,
                     report: Report) -> None:
    """A local datasheet has to exist; pages need something to cut from."""
    if line.datasheet_pages and not line.datasheet:
        report.warnings.append(Problem(
            line.id, "datasheet_pages",
            "datasheet_pages is set but there is no datasheet to take them "
            "from"))
    if not line.datasheet or absolute_url(line.datasheet):
        return
    path = Path(line.datasheet).expanduser()
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    if not path.is_file():
        report.warnings.append(Problem(
            line.id, "datasheet",
            f"{line.datasheet!r} is not a file (looked for {path}), so no "
            f"datasheet will be attached"))


def _check_identity(line: StockLine, category: CategoryConfig,
                    report: Report) -> None:
    """Is there enough here to find or create a part at all?"""
    if line.ipn or line.sku or line.mpn or line.type:
        return
    if category.identity == "spec":
        return                                   # the parameters are the identity
    if line.description:
        report.warnings.append(Problem(
            line.id, "type",
            f"{category.pathstring} identifies parts by "
            f"{category.identity}, and this line gives none - it will be "
            f"created from its description alone"))
        return
    report.problems.append(Problem(
        line.id, "type",
        f"nothing identifies this part: {category.pathstring} needs a type, "
        f"an mpn, a sku, an ipn, or a description"))


def check_conditions(document: StockFile) -> list[Problem]:
    """Conditions are validated on read; this re-states the vocabulary."""
    return [Problem(line.id, "condition",
                    f"{line.condition!r} is not one of "
                    f"{', '.join(CONDITIONS)}")
            for line in document.lines if line.condition not in CONDITIONS]
