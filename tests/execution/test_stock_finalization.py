"""Immutable stock evidence, effect attribution and pending-transfer recovery."""
from __future__ import annotations

import json
from hashlib import sha256
from zipfile import ZipFile

import pytest

from tests.execution.test_full_stock import full
from tests.execution.test_stock_workflow import TARGET, document, operation, row, scene as scene
from invimport.execution.models import State
from invimport.execution.stock_finalization import artifact_path
from invimport.execution.stock_preparation import PreparationReview
from invimport.execution.stock_workflow import execute_stock, repair_stock, resume_stock


def test_finalization_waits_for_failed_and_blocked_branches_and_retains_uncertainty(scene, tmp_path):
    api = scene[0]
    doc = document(tmp_path)
    plan = full(scene, doc, archive=False)
    api.fail('stock/', 'lost')
    directory = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    assert row(snapshot, operation(plan, 'stock'))['state'] == State.UNCERTAIN
    provenance = operation(plan, 'provenance_snapshot')
    assert row(snapshot, provenance)['state'] == State.SUCCEEDED
    changes = json.loads(artifact_path(directory, provenance.id).read_bytes())['changes']
    assert any(change['model'] == 'part.part' and change['certainty'] == 'confirmed' for change in changes)
    assert not snapshot['report']['lines'][0]['complete']



def test_archive_uses_fixed_manifest_excludes_run_state_and_noop_has_no_new_archive(scene, tmp_path):
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    (folder / 'evidence.txt').write_bytes(b'evidence')
    (folder / 'PLAN.json').write_text(json.dumps({'plan_version': 1, 'file': 'input.json', 'file_id': 'fixture', 'lines': [{'existing_part': {'image': 'report-images/downloaded.png'}}]}))
    (folder / 'old.provenance.json').write_text(json.dumps({'format': 'invimport-provenance/1'}))
    (folder / 'report-images').mkdir()
    (folder / 'report-images' / 'downloaded.png').write_bytes(b'not a source')
    directory = folder / 'run'
    directory.mkdir()
    (directory / '.invimport-run').write_text('marker')
    (directory / 'run.sqlite3-wal').write_bytes(b'live journal')
    plan = full(scene, doc)
    archive = operation(plan, 'evidence_archive')
    names = {entry['name'] for entry in archive.desired.values()['manifest']}
    assert names == {'input.json', 'evidence.txt'}
    # A custom run root was already excluded by marker identity. Execute elsewhere.
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=run)
    path = artifact_path(run, archive.id)
    original = path.read_bytes()
    with ZipFile(path) as archive_file:
        assert '.invimport-evidence/source-manifest.json' in archive_file.namelist()
        assert 'run/run.sqlite3-wal' not in archive_file.namelist()
    assert sha256(original).hexdigest()[:20] in next(item['filename'] for item in scene[0].get('attachment/') if item['filename'].endswith('.zip'))
    later = full(scene, doc)
    again = execute_stock(later, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'noop')
    assert row(again, operation(later, 'evidence_archive'))['state'] == State.SKIPPED
    assert not artifact_path(tmp_path / 'noop', operation(later, 'evidence_archive').id).exists()
    assert path.read_bytes() == original
    assert all(line['registered'] for line in snapshot['report']['lines'])
    from invimport.execution.stock_workflow import project_stock_result
    projected = project_stock_result(plan, snapshot, run_directory=run)
    assert projected.archive and projected.archive.targets[0].outcome == 'attached'
    assert projected.provenance and projected.provenance.file.is_file()



def test_pending_archive_upload_survives_source_deletion_and_fresh_process_repair(scene, tmp_path):
    import os
    import subprocess
    import sys
    api = scene[0]
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    plan = full(scene, doc)
    api.fail('attachment/', 'rejected')
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    upload = next(op for op in plan.operations if op.desired.values().get('role') == 'archive')
    assert row(snapshot, upload)['state'] == State.FAILED
    archive = operation(plan, 'evidence_archive')
    original = artifact_path(run, archive.id).read_bytes()
    doc.path.unlink()
    saved = tmp_path / 'saved-plan.json'
    saved.write_text(plan.dumps())
    code = '''
import sys
from pathlib import Path
from tests.execution.stock_server import StockServer
from tests.execution.test_stock_workflow import TARGET
from invimport.execution.models import Plan
from invimport.execution.stock_workflow import repair_stock
plan = Plan.loads(Path(sys.argv[1]).read_text())
api = StockServer(Path(sys.argv[2]))
repair_stock(plan, sys.argv[3], Path(sys.argv[4]), sys.argv[5], api=api, current_target=TARGET)
'''
    subprocess.run([sys.executable, '-c', code, str(saved), str(api.path), snapshot['run_id'], str(run / 'run.sqlite3'), upload.id], check=True, env=os.environ.copy())
    assert len(api.get('stock/')) == 2
    assert artifact_path(run, archive.id).read_bytes() == original
    assert len([item for item in api.get('attachment/') if item['filename'].endswith('.zip')]) == 1



def test_repaired_inventory_appends_artifact_revision_without_rewriting_history(scene, tmp_path):
    from invimport.execution.stock_finalization import prepared_artifacts, prepared_path
    from invimport.execution.store import RunStore
    api = scene[0]
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    plan = full(scene, doc)
    api.fail('stock/', 'rejected')
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    archive = operation(plan, 'evidence_archive')
    before = artifact_path(run, archive.id).read_bytes()
    old_uploads = {item['filename'] for item in api.get('attachment/')}
    repaired = repair_stock(plan, snapshot['run_id'], run / 'run.sqlite3', operation(plan, 'stock').id,
                            api=api, current_target=TARGET)
    assert len(api.get('stock/')) == 2
    assert artifact_path(run, archive.id).read_bytes() == before
    with RunStore(run / 'run.sqlite3', plan=plan, run_id=snapshot['run_id'], create=False) as store:
        revisions = prepared_artifacts(store, archive.id)
        assert len(revisions) == 2
        assert len({entry['sha256'] for entry in revisions}) == 2
        assert prepared_path(store, revisions[0], archive.id).read_bytes() == before
    assert old_uploads <= {item['filename'] for item in api.get('attachment/')}
    count = len(api.get('attachment/'))
    resume_stock(plan, repaired['run_id'], run / 'run.sqlite3', api=api, current_target=TARGET)
    assert len(api.get('attachment/')) == count



@pytest.mark.parametrize('missing', [True, False])
def test_retained_archive_missing_or_modified_blocks_upload(scene, tmp_path, monkeypatch, missing):
    from invimport.execution.stock_handlers import StockHandlers
    api = scene[0]
    folder = tmp_path / 'fixture'
    folder.mkdir()
    plan = full(scene, document(folder))
    archive = operation(plan, 'evidence_archive')
    run = tmp_path / 'run'
    original = StockHandlers.run
    def corrupt(self, spec, context):
        if spec.desired.values().get('role') == 'archive':
            path = artifact_path(run, archive.id)
            if missing:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(b'changed after preparation')
        return original(self, spec, context)
    monkeypatch.setattr(StockHandlers, 'run', corrupt)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    upload = next(op for op in plan.operations if op.desired.values().get('role') == 'archive')
    assert row(snapshot, upload)['state'] == State.NEEDS_REVIEW
    assert not [item for item in api.get('attachment/') if item['filename'].endswith('.zip')]



def test_source_staging_detects_mutation_during_read(tmp_path, monkeypatch):
    from pathlib import Path
    from invimport.execution.stock_assets import stable_bytes
    source = tmp_path / 'source.txt'
    source.write_bytes(b'original')
    original = Path.read_bytes
    def change(path):
        content = original(path)
        if path == source:
            path.write_bytes(b'new content')
        return content
    monkeypatch.setattr(Path, 'read_bytes', change)
    with pytest.raises(PreparationReview, match='source changed'):
        stable_bytes(source)



@pytest.mark.parametrize('source_kind', ['traversal', 'symlink'])
def test_source_assets_cannot_escape_source_directory(scene, tmp_path, source_kind):
    doc = document(tmp_path)
    outside = tmp_path.parent / (tmp_path.name + '-private.txt')
    outside.write_bytes(b'not an approved import source')
    if source_kind == 'symlink':
        source = tmp_path / 'linked.txt'
        source.symlink_to(outside)
        reference = source.name
    else:
        reference = '../' + outside.name
    doc.lines[0].attachments = [(reference, 'outside')]
    with pytest.raises(PreparationReview, match='escapes'):
        full(scene, doc)
    assert not scene[0].get('stock/')



def test_versioned_confirmed_archive_transfer_is_verification_only_when_listing_empty(scene, tmp_path, monkeypatch):
    api = scene[0]
    folder = tmp_path / 'fixture'
    folder.mkdir()
    plan = full(scene, document(folder))
    original = api.get
    def hide(route, *, params=None):
        return [] if route == 'attachment/' else original(route, params=params)
    monkeypatch.setattr(api, 'get', hide)
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    upload = next(op for op in plan.operations if op.desired.values().get('role') == 'archive')
    assert row(snapshot, upload)['state'] == State.NEEDS_REVIEW
    count = len(original('attachment/'))
    for _ in range(2):
        snapshot = repair_stock(plan, snapshot['run_id'], run / 'run.sqlite3', upload.id, api=api, current_target=TARGET)
    assert len(original('attachment/')) == count



def test_artifact_disk_failure_stops_before_later_remote_mutations(scene, tmp_path, monkeypatch):
    from invimport.execution.ownership import JournalError
    from pathlib import Path
    api = scene[0]
    doc = document(tmp_path)
    (tmp_path / 'label.txt').write_bytes(b'label')
    doc.lines[0].attachments = [('label.txt', 'label')]
    plan = full(scene, doc, archive=False, provenance=False)
    original = Path.open
    def fail(path, mode='r', *args, **kwargs):
        if mode == 'xb' and path.parent.name == 'artifacts':
            raise OSError('disk unavailable')
        return original(path, mode, *args, **kwargs)
    monkeypatch.setattr(Path, 'open', fail)
    with pytest.raises(JournalError, match='persistence failed'):
        execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    # First lot can settle before its optional asset staging fails; the second
    # independent lot must not mutate after a global disk/journal failure.
    assert len(api.get('stock/')) == 1
    assert not api.get('attachment/')



def test_provenance_confirms_actual_parameter_fields_and_never_part_parameters(scene, tmp_path):
    api = scene[0]
    plan = full(scene, document(tmp_path), archive=False)
    api.fail('parameter/', 'rejected')
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    changes = json.loads(artifact_path(run, operation(plan, 'provenance_snapshot').id).read_bytes())['changes']
    part = next(change for change in changes if change['model'] == 'part.part' and change['kind'] == 'create')
    assert 'parameters' not in part['confirmed_fields']
    assert part['confirmed_fields']['name']
    parameters = [change for change in changes if change['model'] == 'common.parameter']
    assert parameters
    assert all({'model_id', 'model_type', 'template', 'data'} <= set(change['confirmed_fields']) for change in parameters)
    assert row(snapshot, operation(plan, 'parameter'))['state'] == State.FAILED



def test_source_manifest_excludes_canonical_root_and_generated_plan_by_content(scene, tmp_path, monkeypatch):
    from invimport.execution.stock_finalization import frozen_sources
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    canonical_root = folder / 'private-state'
    canonical_root.mkdir()
    (canonical_root / 'sensitive.txt').write_bytes(b'never evidence')
    monkeypatch.setenv('INVIMPORT_STATE_DIR', str(canonical_root))
    (folder / 'arbitrary-review-output.json').write_text(json.dumps({'plan_version': 1, 'file': 'input.json', 'file_id': 'fixture', 'lines': []}))
    manifest = frozen_sources(doc)
    assert {item['name'] for item in manifest} == {'input.json'}
