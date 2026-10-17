"""Archive evidence, routing and failure handling without a live server."""

from __future__ import annotations

import hashlib
import os
import zipfile
from types import SimpleNamespace

import pytest

from invimport.inventree import archive
from invimport.stockfile import StockFile


@pytest.fixture
def document(tmp_path):
    folder = tmp_path / "bench-lot"
    folder.mkdir()
    path = folder / "bench-lot.json"
    path.write_bytes(b'{"lines": []}')
    return StockFile(path=path)


@pytest.fixture
def transport(monkeypatch):
    rows = {}
    listed = []
    uploaded = []

    def attachments(api, model, pk):
        listed.append((model, pk))
        return rows.get((model, pk), [])

    def attach(api, model, pk, path, comment):
        uploaded.append(SimpleNamespace(
            model=model, pk=pk, path=path, comment=comment,
            contents=path.read_bytes(),
        ))
        return True

    monkeypatch.setattr(archive, "attachments", attachments)
    monkeypatch.setattr(archive, "attach_file", attach)
    return SimpleNamespace(rows=rows, listed=listed, uploaded=uploaded)


def action(line_id="l1", **overrides):
    fields = dict(
        id=line_id, action="created", purchase_order=None,
        order_reference="", supplier=None, supplier_name="",
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def order(line_id="l1", pk=12, **overrides):
    return action(line_id, purchase_order=pk, **overrides)


def supplier(line_id="l1", pk=34, **overrides):
    return action(line_id, supplier=pk, **overrides)


def test_in_memory_documents_explain_why_they_have_no_archive():
    folder, reason = archive.import_folder(StockFile())
    assert folder is None
    assert reason == "the import was not read from a file"


def test_file_stem_identifies_the_import_folder(document):
    folder, reason = archive.import_folder(document)
    assert folder == document.path.parent
    assert reason == ""


def test_source_reference_allows_a_differently_named_redo(document):
    document.path = document.path.with_name("redo.yaml")
    document.source = {"reference": "bench-lot"}
    folder, reason = archive.import_folder(document)
    assert folder == document.path.parent
    assert reason == ""


def test_reference_whitespace_does_not_prevent_folder_matching(document):
    document.path = document.path.with_name("redo.csv")
    document.source = {"reference": "  bench-lot \n"}
    folder, reason = archive.import_folder(document)
    assert folder == document.path.parent
    assert reason == ""


def test_an_unrelated_reference_does_not_override_a_matching_stem(document):
    document.source = {"reference": "some-other-lot"}
    folder, reason = archive.import_folder(document)
    assert folder == document.path.parent
    assert reason == ""


@pytest.mark.parametrize("source", [{}, {"reference": ""}, {"reference": None}])
def test_flat_layout_reports_a_concrete_destination(document, source):
    document.path = document.path.with_name("other.json")
    document.source = source
    folder, reason = archive.import_folder(document)
    assert folder is None
    assert reason == (
        "other.json is not in its own import folder - move it and its "
        "sources to .local_imports/other/"
    )


def test_relative_document_paths_resolve_from_the_working_directory(
        document, monkeypatch):
    monkeypatch.chdir(document.path.parent.parent)
    expected = document.path.parent
    document.path = document.path.relative_to(expected.parent)
    folder, reason = archive.import_folder(document)
    assert folder == expected
    assert folder.is_absolute()
    assert reason == ""


def test_nested_visible_files_are_collected_in_relative_path_order(document):
    folder = document.path.parent
    (folder / "sources").mkdir()
    (folder / "sources" / "z.jpg").write_bytes(b"photo")
    (folder / "a.txt").write_bytes(b"notes")
    assert [p.relative_to(folder).as_posix()
            for p in archive.archive_files(folder)] == [
        "a.txt", "bench-lot.json", "sources/z.jpg",
    ]


@pytest.mark.parametrize("relative", [
    ".DS_Store",
    ".secret",
    ".hidden/evidence.jpg",
    "photos/.hidden/evidence.jpg",
    "photos/.metadata",
])
def test_hidden_files_and_hidden_ancestors_are_excluded(document, relative):
    folder = document.path.parent
    hidden = folder / relative
    hidden.parent.mkdir(parents=True, exist_ok=True)
    hidden.write_bytes(b"machine-local")
    assert archive.archive_files(folder) == [document.path]


@pytest.mark.parametrize("filename", [
    "import-bench-lot-previous.zip",
    "import-another-lot.zip",
    "import-bench-lot.ZIP",
])
def test_prior_import_zips_are_excluded_even_with_uppercase_suffix(
        document, filename):
    folder = document.path.parent
    (folder / filename).write_bytes(b"old archive")
    assert archive.archive_files(folder) == [document.path]


@pytest.mark.parametrize("filename", [
    "supplier-evidence.zip",
    "import-notes.txt",
    "photo.jpg",
    "README",
])
def test_visible_evidence_is_kept_even_when_it_is_a_zip(document, filename):
    folder = document.path.parent
    evidence = folder / filename
    evidence.write_bytes(b"evidence")
    assert evidence in archive.archive_files(folder)


def test_empty_directories_do_not_become_archive_entries(document):
    (document.path.parent / "empty").mkdir()
    assert archive.archive_files(document.path.parent) == [document.path]


def test_empty_files_are_evidence_too(document):
    empty = document.path.parent / "empty.txt"
    empty.touch()
    assert empty in archive.archive_files(document.path.parent)


def test_empty_folder_has_no_files(tmp_path):
    assert archive.archive_files(tmp_path) == []


def test_empty_archive_digest_is_sha256_of_empty_bytes(tmp_path):
    assert archive.archive_digest(tmp_path, []) == hashlib.sha256(b"").hexdigest()


def test_digest_has_a_stable_wire_representation(document):
    expected = hashlib.sha256(b'bench-lot.json\0{"lines": []}\0').hexdigest()
    assert archive.archive_digest(document.path.parent, [document.path]) == expected


def test_digest_changes_when_evidence_changes(document):
    folder = document.path.parent
    first = archive.archive_digest(folder, [document.path])
    document.path.write_bytes(b'{"lines": [1]}')
    assert archive.archive_digest(folder, [document.path]) != first


def test_digest_changes_when_evidence_is_renamed(document):
    folder = document.path.parent
    first = archive.archive_digest(folder, [document.path])
    renamed = document.path.rename(folder / "renamed.json")
    assert archive.archive_digest(folder, [renamed]) != first


def test_digest_distinguishes_identical_basenames_in_different_folders(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    first = tmp_path / "a" / "label.jpg"
    second = tmp_path / "b" / "label.jpg"
    first.write_bytes(b"same")
    second.write_bytes(b"same")
    assert archive.archive_digest(tmp_path, [first]) != archive.archive_digest(
        tmp_path, [second])


def test_digest_does_not_depend_on_the_absolute_parent(document, tmp_path):
    other = tmp_path / "copy"
    other.mkdir()
    copied = other / document.path.name
    copied.write_bytes(document.path.read_bytes())
    assert archive.archive_digest(document.path.parent, [document.path]) == (
        archive.archive_digest(other, [copied]))


def test_digest_does_not_depend_on_file_timestamps(document):
    folder = document.path.parent
    first = archive.archive_digest(folder, [document.path])
    os.utime(document.path, (1_000_000_000, 1_000_000_000))
    assert archive.archive_digest(folder, [document.path]) == first


def test_digest_reads_beyond_the_first_megabyte(document):
    folder = document.path.parent
    document.path.write_bytes(b"a" * (1 << 20) + b"first tail")
    first = archive.archive_digest(folder, [document.path])
    document.path.write_bytes(b"a" * (1 << 20) + b"other tail")
    assert archive.archive_digest(folder, [document.path]) != first


def test_digest_delimits_paths_and_contents(tmp_path):
    first = tmp_path / "a"
    second = tmp_path / "ab"
    first.write_bytes(b"bc")
    second.write_bytes(b"c")
    assert archive.archive_digest(tmp_path, [first]) != archive.archive_digest(
        tmp_path, [second])


def test_digest_accepts_a_single_pass_file_iterator(document):
    folder = document.path.parent
    assert archive.archive_digest(folder, iter([document.path])) == (
        archive.archive_digest(folder, [document.path]))


def test_archive_name_uses_the_folder_and_short_digest(document):
    name = archive.archive_name(document.path.parent, "abcdef0123456789")
    assert name == "import-bench-lot-abcdef012345.zip"


def test_archive_comment_reports_evidence_count_and_digest(document):
    report = archive.ImportArchive(
        folder=document.path.parent, files=["a.json", "photo.jpg"],
        digest="abcdef0123456789",
    )
    assert archive.archive_comment(report) == (
        "Import archive: bench-lot - the import file and its sources, "
        "2 file(s), sha256 abcdef012345"
    )


def test_zip_retains_binary_contents_and_relative_layout(document, tmp_path):
    folder = document.path.parent
    (folder / "photos").mkdir()
    photo = folder / "photos" / "label.jpg"
    photo.write_bytes(bytes(range(256)))
    target = tmp_path / "evidence.zip"
    result = archive.build_zip(folder, archive.archive_files(folder), target)
    assert result == target
    with zipfile.ZipFile(target) as zipped:
        assert zipped.namelist() == [
            "bench-lot/bench-lot.json", "bench-lot/photos/label.jpg",
        ]
        assert zipped.read("bench-lot/photos/label.jpg") == bytes(range(256))
        assert zipped.read("bench-lot/bench-lot.json") == document.path.read_bytes()


def test_zip_metadata_is_fixed_for_every_entry(document, tmp_path):
    target = tmp_path / "evidence.zip"
    archive.build_zip(document.path.parent, [document.path], target)
    with zipfile.ZipFile(target) as zipped:
        for info in zipped.infolist():
            assert info.date_time == (1980, 1, 1, 0, 0, 0)
            assert info.external_attr >> 16 == 0o644
            assert info.compress_type == zipfile.ZIP_DEFLATED


def test_zip_accepts_a_single_pass_iterator(document, tmp_path):
    target = tmp_path / "evidence.zip"
    archive.build_zip(document.path.parent, iter([document.path]), target)
    with zipfile.ZipFile(target) as zipped:
        assert zipped.namelist() == ["bench-lot/bench-lot.json"]


def test_zip_can_represent_an_empty_evidence_folder(tmp_path):
    folder = tmp_path / "empty"
    folder.mkdir()
    target = tmp_path / "empty.zip"
    archive.build_zip(folder, [], target)
    with zipfile.ZipFile(target) as zipped:
        assert zipped.namelist() == []


def test_zip_preserves_unicode_filenames_and_contents(document, tmp_path):
    folder = document.path.parent
    evidence = folder / "résistance-Ω.txt"
    evidence.write_text("4.7 kΩ ±1%", encoding="utf-8")
    target = tmp_path / "unicode.zip"
    archive.build_zip(folder, [evidence], target)
    with zipfile.ZipFile(target) as zipped:
        assert zipped.read("bench-lot/résistance-Ω.txt").decode("utf-8") == (
            "4.7 kΩ ±1%")


def test_zip_does_not_rewrite_source_files(document, tmp_path):
    before = document.path.read_bytes()
    modified = document.path.stat().st_mtime_ns
    archive.build_zip(document.path.parent, [document.path], tmp_path / "a.zip")
    assert document.path.read_bytes() == before
    assert document.path.stat().st_mtime_ns == modified


def test_no_actions_means_no_targets():
    assert archive.plan_targets([]) == ([], [])


@pytest.mark.parametrize("status", ["skipped", "failed", "cancelled", "", None])
def test_unsuccessful_lines_do_not_get_archive_targets(status):
    targets, unattached = archive.plan_targets([order(action=status)])
    assert targets == []
    assert unattached == []


@pytest.mark.parametrize("status", ["created", "exists"])
def test_both_new_and_existing_stock_keep_their_evidence(status):
    targets, unattached = archive.plan_targets([order(action=status)])
    assert [(t.kind, t.pk, t.lines) for t in targets] == [
        (archive.PURCHASE_ORDER, 12, ["l1"]),
    ]
    assert unattached == []


def test_actions_without_a_status_are_ignored():
    assert archive.plan_targets([SimpleNamespace(id="l1")]) == ([], [])


def test_an_order_takes_precedence_over_its_supplier():
    targets, _ = archive.plan_targets([order(supplier=34)])
    assert [(t.kind, t.pk) for t in targets] == [(archive.PURCHASE_ORDER, 12)]


def test_order_labels_include_the_reference_when_present():
    targets, _ = archive.plan_targets([order(order_reference="INV-9")])
    assert targets[0].label == "12 (INV-9)"
    assert targets[0].model_type == "purchaseorder"


def test_an_order_without_a_reference_still_has_a_label():
    targets, _ = archive.plan_targets([order()])
    assert targets[0].label == "12"


def test_repeated_order_targets_collect_line_ids_in_input_order():
    targets, _ = archive.plan_targets([
        order("b"), order("a", action="exists"), order("c"),
    ])
    assert len(targets) == 1
    assert targets[0].lines == ["b", "a", "c"]


def test_target_order_follows_first_appearance():
    targets, _ = archive.plan_targets([
        supplier("s"), order("o"), supplier("s2"),
    ])
    assert [(t.kind, t.lines) for t in targets] == [
        (archive.SUPPLIER, ["s", "s2"]),
        (archive.PURCHASE_ORDER, ["o"]),
    ]


def test_order_and_supplier_with_the_same_pk_are_separate_targets():
    targets, _ = archive.plan_targets([order(pk=12), supplier("l2", pk=12)])
    assert [(t.model_type, t.pk) for t in targets] == [
        ("purchaseorder", 12), ("company", 12),
    ]


def test_existing_supplier_label_includes_its_name():
    targets, _ = archive.plan_targets([supplier(supplier_name="Surplus shop")])
    assert targets[0].label == "34 Surplus shop"
    assert targets[0].model_type == "company"


def test_supplier_label_has_no_trailing_space_without_a_name():
    targets, _ = archive.plan_targets([supplier()])
    assert targets[0].label == "34"


def test_new_suppliers_group_by_name_rather_than_placeholder_pk():
    targets, _ = archive.plan_targets([
        supplier("a", pk=-1, supplier_name="Shop A"),
        supplier("b", pk=-1, supplier_name="Shop B"),
        supplier("c", pk=-2, supplier_name="Shop A"),
    ])
    assert [(t.pk, t.label, t.lines) for t in targets] == [
        (None, "new supplier Shop A", ["a", "c"]),
        (None, "new supplier Shop B", ["b"]),
    ]


def test_new_orders_group_by_supplier_and_reference():
    targets, _ = archive.plan_targets([
        supplier("a", order_reference="INV-1", supplier_name="A"),
        supplier("b", order_reference="INV-1", supplier_name="B"),
        supplier("c", order_reference="INV-2", supplier_name="A"),
        supplier("d", order_reference="INV-1", supplier_name="A"),
    ])
    assert [(t.pk, t.label, t.lines) for t in targets] == [
        (None, "new order INV-1 from A", ["a", "d"]),
        (None, "new order INV-1 from B", ["b"]),
        (None, "new order INV-2 from A", ["c"]),
    ]


def test_order_reference_without_supplier_has_nowhere_to_attach():
    targets, unattached = archive.plan_targets([action(order_reference="INV-1")])
    assert targets == []
    assert unattached == ["l1"]


def test_only_imported_lines_appear_in_the_unattached_report():
    targets, unattached = archive.plan_targets([
        action("created"), action("old", action="exists"),
        action("bad", action="failed"), action("skip", action="skipped"),
    ])
    assert targets == []
    assert unattached == ["created", "old"]


def test_target_planning_accepts_a_single_pass_iterator():
    targets, unattached = archive.plan_targets(iter([order(), action("l2")]))
    assert targets[0].lines == ["l1"]
    assert unattached == ["l2"]


def test_report_lists_are_independent_between_instances():
    first = archive.ImportArchive()
    second = archive.ImportArchive()
    first.files.append("a")
    first.unattached.append("l1")
    first.targets.append(archive.ArchiveTarget(archive.SUPPLIER, 1, "A"))
    assert second.files == []
    assert second.unattached == []
    assert second.targets == []


def test_target_lists_are_independent_between_instances():
    first = archive.ArchiveTarget(archive.SUPPLIER, 1, "A")
    second = archive.ArchiveTarget(archive.SUPPLIER, 2, "B")
    first.lines.append("l1")
    first.earlier.append("old.zip")
    assert second.lines == []
    assert second.earlier == []


def test_counts_include_zeroes_for_missing_outcomes():
    assert archive.ImportArchive().counts() == {
        "attached": 0, "would attach": 0, "already attached": 0, "failed": 0,
    }


def test_counts_measure_targets_rather_than_lines():
    report = archive.ImportArchive(targets=[
        archive.ArchiveTarget(archive.SUPPLIER, 1, "A", lines=["a", "b"],
                              outcome=archive.ATTACHED),
        archive.ArchiveTarget(archive.PURCHASE_ORDER, 2, "B",
                              outcome=archive.FAILED),
        archive.ArchiveTarget(archive.SUPPLIER, 3, "C"),
        archive.ArchiveTarget(archive.SUPPLIER, 4, "D",
                              outcome=archive.ALREADY_ATTACHED),
    ])
    assert report.counts() == {
        "attached": 1, "would attach": 1, "already attached": 1, "failed": 1,
    }


def test_in_memory_import_never_contacts_the_attachment_transport(transport):
    report = archive.archive_import(object(), StockFile(), [order()], write=True)
    assert report.reason == "the import was not read from a file"
    assert transport.listed == []
    assert transport.uploaded == []


def test_unrelated_folder_never_contacts_the_transport(document, transport):
    document.path = document.path.with_name("unrelated.json")
    report = archive.archive_import(object(), document, [order()], write=True)
    assert "not in its own import folder" in report.reason
    assert transport.listed == []
    assert transport.uploaded == []


def test_dry_run_reports_uncompressed_evidence_size(document, transport):
    photo = document.path.parent / "photo.jpg"
    photo.write_bytes(b"photo bytes")
    report = archive.archive_import(object(), document, [order()])
    assert report.folder == document.path.parent
    assert report.files == ["bench-lot.json", "photo.jpg"]
    assert report.size == len(document.path.read_bytes()) + len(b"photo bytes")
    assert report.reason == ""
    assert report.targets[0].outcome == archive.WOULD_ATTACH
    assert transport.uploaded == []


def test_dry_run_does_not_build_a_zip(document, transport, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("a dry run must not build a zip")

    monkeypatch.setattr(archive, "build_zip", forbidden)
    archive.archive_import(object(), document, [order()])
    assert transport.listed == [("purchaseorder", 12)]
    assert transport.uploaded == []


def test_write_with_no_targets_does_not_build_a_zip(
        document, transport, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("there is no record to hold this zip")

    monkeypatch.setattr(archive, "build_zip", forbidden)
    report = archive.archive_import(object(), document, [action()], write=True)
    assert report.unattached == ["l1"]
    assert transport.listed == []
    assert transport.uploaded == []


def test_new_records_are_only_planned_even_with_write_enabled(document, transport):
    report = archive.archive_import(object(), document, [
        supplier(pk=-1, supplier_name="New shop"),
    ], write=True)
    assert report.targets[0].pk is None
    assert report.targets[0].outcome == archive.WOULD_ATTACH
    assert transport.listed == []
    assert transport.uploaded == []


def test_write_uploads_the_zip_with_an_evidence_comment(document, transport):
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.targets[0].outcome == archive.ATTACHED
    assert len(transport.uploaded) == 1
    upload = transport.uploaded[0]
    assert (upload.model, upload.pk) == ("purchaseorder", 12)
    assert upload.path.name == report.name
    assert upload.comment == archive.archive_comment(report)
    assert upload.contents.startswith(b"PK")
    assert not upload.path.exists()


def test_one_zip_is_reused_for_all_pending_targets(document, transport, monkeypatch):
    built = []
    real_build = archive.build_zip

    def build(folder, files, target):
        built.append(target)
        return real_build(folder, files, target)

    monkeypatch.setattr(archive, "build_zip", build)
    report = archive.archive_import(object(), document, [
        order(), supplier("l2"), order("l3", pk=99),
    ], write=True)
    assert len(built) == 1
    assert len(transport.uploaded) == 3
    assert len({u.path for u in transport.uploaded}) == 1
    assert len({u.contents for u in transport.uploaded}) == 1
    assert report.counts()[archive.ATTACHED] == 3


def test_exact_filename_prevents_an_upload(document, transport):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [{"filename": planned.name}]
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.targets[0].outcome == archive.ALREADY_ATTACHED
    assert transport.uploaded == []


def test_server_storage_prefix_is_ignored_when_matching_names(document, transport):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [
        {"filename": "attachments/2026/10/" + planned.name},
    ]
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.targets[0].outcome == archive.ALREADY_ATTACHED
    assert transport.uploaded == []


def test_digest_comment_matches_a_server_renamed_attachment(document, transport):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [{
        "filename": "server-renamed.zip",
        "comment": archive.archive_comment(planned),
    }]
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.targets[0].outcome == archive.ALREADY_ATTACHED
    assert transport.uploaded == []


def test_unrelated_digest_comment_does_not_suppress_upload(document, transport):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [{
        "filename": "notes.txt", "comment": f"sha256 {planned.digest[:12]}",
    }]
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.targets[0].outcome == archive.ATTACHED
    assert len(transport.uploaded) == 1


def test_earlier_versions_are_sorted_and_other_imports_are_excluded(
        document, transport):
    transport.rows[("purchaseorder", 12)] = [
        {"filename": "import-bench-lot-zzzz.zip"},
        {"filename": "storage/import-bench-lot-aaaa.zip"},
        {"filename": "import-other-aaaa.zip"},
        {"filename": "import-bench-lot-not-a-zip.txt"},
        {"filename": None, "comment": None},
    ]
    report = archive.archive_import(object(), document, [order()])
    assert report.targets[0].earlier == [
        "import-bench-lot-aaaa.zip", "import-bench-lot-zzzz.zip",
    ]
    assert report.targets[0].outcome == archive.WOULD_ATTACH


def test_current_version_is_not_reported_as_an_earlier_version(document, transport):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [
        {"filename": planned.name}, {"filename": "import-bench-lot-old.zip"},
    ]
    report = archive.archive_import(object(), document, [order()])
    assert report.targets[0].earlier == ["import-bench-lot-old.zip"]
    assert report.targets[0].outcome == archive.ALREADY_ATTACHED


def test_existing_target_does_not_prevent_upload_to_another(document, transport):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [{"filename": planned.name}]
    report = archive.archive_import(object(), document, [order(), supplier("l2")],
                                    write=True)
    assert [t.outcome for t in report.targets] == [
        archive.ALREADY_ATTACHED, archive.ATTACHED,
    ]
    assert [(u.model, u.pk) for u in transport.uploaded] == [("company", 34)]


def test_listing_failure_is_logged_and_does_not_abort_other_targets(
        document, transport, monkeypatch, caplog):
    def unavailable(api, model, pk):
        if model == "purchaseorder":
            raise RuntimeError("server unavailable")
        return []

    monkeypatch.setattr(archive, "attachments", unavailable)
    report = archive.archive_import(object(), document, [order(), supplier("l2")])
    assert [t.outcome for t in report.targets] == [archive.WOULD_ATTACH] * 2
    assert "could not list attachments on purchaseorder 12" in caplog.text
    assert "server unavailable" in caplog.text
    assert transport.uploaded == []


def test_zip_failure_marks_pending_targets_and_preserves_existing_ones(
        document, transport, monkeypatch):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [{"filename": planned.name}]

    def no_space(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(archive, "build_zip", no_space)
    report = archive.archive_import(object(), document, [
        order(), supplier("l2"), order("l3", pk=99),
    ], write=True)
    assert [t.outcome for t in report.targets] == [
        archive.ALREADY_ATTACHED, archive.FAILED, archive.FAILED,
    ]
    assert report.reason == f"could not zip {document.path.parent}: disk full"
    assert transport.uploaded == []


def test_failed_upload_does_not_prevent_later_uploads(
        document, transport, monkeypatch):
    attempts = []

    def attach(api, model, pk, path, comment):
        attempts.append((model, pk))
        assert path.exists()
        return model != "purchaseorder"

    monkeypatch.setattr(archive, "attach_file", attach)
    report = archive.archive_import(object(), document, [order(), supplier("l2")],
                                    write=True)
    assert attempts == [("purchaseorder", 12), ("company", 34)]
    assert [t.outcome for t in report.targets] == [archive.FAILED, archive.ATTACHED]
    assert report.reason == ""


def test_failed_upload_also_cleans_up_the_temporary_zip(
        document, transport, monkeypatch):
    paths = []

    def attach(api, model, pk, path, comment):
        paths.append(path)
        return False

    monkeypatch.setattr(archive, "attach_file", attach)
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.targets[0].outcome == archive.FAILED
    assert len(paths) == 1
    assert not paths[0].exists()
    assert not paths[0].parent.exists()


def test_all_existing_targets_avoid_rebuilding_the_zip(
        document, transport, monkeypatch):
    planned = archive.archive_import(object(), document, [order()])
    transport.rows[("purchaseorder", 12)] = [{"filename": planned.name}]

    def forbidden(*args, **kwargs):
        pytest.fail("the evidence is already attached")

    monkeypatch.setattr(archive, "build_zip", forbidden)
    report = archive.archive_import(object(), document, [order()], write=True)
    assert report.counts()[archive.ALREADY_ATTACHED] == 1
    assert transport.uploaded == []


def test_source_files_remain_after_a_successful_upload(document, transport):
    before = document.path.read_bytes()
    archive.archive_import(object(), document, [order()], write=True)
    assert document.path.read_bytes() == before
    assert archive.archive_files(document.path.parent) == [document.path]
    assert len(transport.uploaded) == 1


def test_uploaded_zip_contains_the_reported_evidence(document, transport):
    import io

    photo = document.path.parent / "photo.jpg"
    photo.write_bytes(b"label evidence")
    report = archive.archive_import(object(), document, [order()], write=True)
    with zipfile.ZipFile(io.BytesIO(transport.uploaded[0].contents)) as zipped:
        assert zipped.namelist() == [f"bench-lot/{name}" for name in report.files]
        assert zipped.read("bench-lot/photo.jpg") == b"label evidence"
        assert sum(entry.file_size for entry in zipped.infolist()) == report.size
    assert len(transport.uploaded) == 1
    assert report.reason == ""
