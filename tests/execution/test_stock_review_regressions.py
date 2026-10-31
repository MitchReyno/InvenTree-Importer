"""Independent-review failures: source integrity, routing, choices and truthfulness."""
from __future__ import annotations

import json
from hashlib import sha256

import pytest

from tests.execution.test_full_stock import full
from tests.execution.test_stock_workflow import TARGET, document, operation, row, scene as scene
from invimport.execution.models import State
from invimport.execution.stock_finalization import artifact_path
from invimport.execution.stock_handlers import StockHandlers
from invimport.execution.stock_preparation import PreparationReview
from invimport.execution.stock_workflow import execute_stock, project_stock_result, repair_stock, resume_stock


def test_legitimate_evidence_is_not_excluded_by_generic_name_or_extension(scene, tmp_path):
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    names = {'downloads/official-datasheet.pdf', 'artifacts/source-label.jpg', 'vendor-evidence.zip',
             'execution-report.json', 'component-journal', 'run.sqlite3', 'import-vendor.zip'}
    for name in names:
        path = folder / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b'legitimate evidence')
    plan = full(scene, doc)
    manifest = operation(plan, 'evidence_archive').desired.values()['manifest']
    assert {entry['name'] for entry in manifest} == names | {'input.json'}
    run = tmp_path / 'run'
    execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=run)
    from zipfile import ZipFile
    with ZipFile(artifact_path(run, operation(plan, 'evidence_archive').id)) as archive:
        assert names <= set(archive.namelist())
        assert all(archive.read(name) == b'legitimate evidence' for name in names)


def test_mixed_order_and_standalone_supplier_each_receive_archive_with_their_sources(scene, tmp_path):
    api = scene[0]
    doc = document(tmp_path)
    doc.lines[1].order = {}
    doc.lines[1].supplier = 'Standalone supplier'
    plan = full(scene, doc)
    uploads = [op for op in plan.operations if op.desired.values().get('role') == 'archive']
    assert {op.attribution.lines for op in uploads} == {('a',), ('b',)}
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    archives = [item for item in api.get('attachment/') if item['filename'].endswith('.zip')]
    assert {item['model_type'] for item in archives} == {'order.purchaseorder', 'company.company'}
    supplier = next(item for item in api.get('company/') if item['name'] == 'Standalone supplier')
    assert any(item['model_id'] == supplier['pk'] for item in archives)
    assert all(row(snapshot, op)['state'] == State.SUCCEEDED for op in uploads)
    projected = project_stock_result(plan, snapshot)
    assert {tuple(target.lines) for target in projected.archive.targets} == {('a',), ('b',)}


def test_failed_preferred_order_uses_frozen_supplier_fallback_and_keeps_recipient_on_repair(scene, tmp_path):
    api = scene[0]
    plan = full(scene, document(tmp_path))
    upload = next(op for op in plan.operations if op.desired.values().get('role') == 'archive')
    assert len(upload.desired.values()['target_alternatives']) == 2
    api.fail('order/po/', 'rejected')
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    assert row(snapshot, upload)['state'] == State.SUCCEEDED
    selected = next(item for item in snapshot['artifact_targets'] if item['operation'] == upload.id)
    assert selected['fallback']
    assert selected['model'] == 'company.company'
    before = [item for item in api.get('attachment/') if item['filename'].endswith('.zip')]
    repaired = repair_stock(plan, snapshot['run_id'], run / 'run.sqlite3', operation(plan, 'order').id,
                            api=api, current_target=TARGET)
    assert all(item['model_type'] == 'company.company' for item in api.get('attachment/') if item['filename'].endswith('.zip'))
    assert all(item in api.get('attachment/') for item in before)
    assert len([item for item in repaired['artifact_targets'] if item['operation'] == upload.id]) == 1


def test_no_usable_applicable_target_is_review_while_disabled_scope_is_inapplicable(scene, tmp_path):
    api = scene[0]
    doc = document(tmp_path)
    plan = full(scene, doc)
    api.fail('company/', 'rejected')
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'failed')
    upload = next(op for op in plan.operations if op.desired.values().get('role') == 'archive')
    assert row(snapshot, upload)['result']['error']['code'] == 'no_usable_applicable_archive_target'
    disabled = full(scene, doc, create_suppliers=False)
    assert not [op for op in disabled.operations if op.desired.values().get('role') == 'archive']
    scope = operation(disabled, 'evidence_archive').desired.values()
    assert scope['inapplicable_reasons'] == {'a': 'supplier_creation_disabled', 'b': 'supplier_creation_disabled'}


@pytest.mark.parametrize('change', [False, True])
@pytest.mark.parametrize('callback', [False, True])
def test_explicit_partial_new_revalidates_declined_candidates_not_absence(scene, tmp_path, change, callback):
    api = scene[0]
    doc = document(tmp_path)
    doc.lines = doc.lines[:1]
    doc.lines[0].parameters.pop('Tolerance')
    existing = api.seed('part/', {'name': 'Existing partial Part', 'IPN': 'R-99999', 'keywords': '',
                                 'category': api.get('part/category/')[0]['pk']})
    api.seed('parameter/', {'model_type': 'part.part', 'model_id': existing['pk'],
                           'template': api.get('parameter/template/')[0]['pk'], 'data': '100'})
    plan = full(scene, doc, on_partial='ask' if callback else 'new',
                choose_part=(lambda line, rows: 'new') if callback else None, archive=False, provenance=False)
    assert operation(plan, 'part').baseline.values()['declined_candidates'][0]['pk'] == existing['pk']
    if change:
        api.patch(f"part/{existing['pk']}/", {'name': 'Changed after approval'})
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert row(snapshot, operation(plan, 'part'))['state'] == (State.NEEDS_REVIEW if change else State.SUCCEEDED)
    assert len(api.get('part/')) == (1 if change else 2)


def test_full_omitted_location_stays_omitted_and_explicit_missing_cannot_become_unlocated(scene, tmp_path):
    doc = document(tmp_path)
    for line in doc.lines:
        line.location = ''
    plan = full(scene, doc, archive=False, provenance=False)
    assert 'location' not in operation(plan, 'stock').desired.values()['payload']
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    assert all(line['registered'] for line in snapshot['report']['lines'])
    doc.lines[0].location = 'Missing explicit shelf'
    with pytest.raises(PreparationReview, match='location'):
        full(scene, doc, create_locations=False)


@pytest.mark.parametrize('existing', [False, True])
def test_escaped_location_segment_resolves_by_name_and_parent(scene, tmp_path, existing):
    api = scene[0]
    doc = document(tmp_path)
    for line in doc.lines:
        line.location = r'Bag/JM38510\/10103BPC'
    if existing:
        parent = api.seed('stock/location/', {'name': 'Bag', 'parent': None, 'pathstring': 'Bag'})
        expected = api.seed('stock/location/', {'name': 'JM38510/10103BPC', 'parent': parent['pk'],
                                              'pathstring': 'Bag/JM38510/10103BPC'})
    plan = full(scene, doc, archive=False, provenance=False)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert all(line['registered'] for line in snapshot['report']['lines'])
    locations = api.get('stock/location/')
    assert len(locations) == 3  # original Shelf plus the two requested names
    child = next(item for item in locations if item['name'] == 'JM38510/10103BPC')
    assert all(stock['location'] == child['pk'] for stock in api.get('stock/'))
    if existing:
        assert child['pk'] == expected['pk']


@pytest.mark.parametrize('field,value', [('order_currency', 'EUR'), ('description', 'Manual edit')])
def test_finalization_uses_shared_frozen_po_metadata_policy(scene, tmp_path, monkeypatch, field, value):
    api = scene[0]
    doc = document(tmp_path)
    for line in doc.lines:
        line.currency = 'USD'
    plan = full(scene, doc)
    original = StockHandlers.run
    def drift(self, spec, context):
        if spec.desired.values()['action'] == 'provenance_snapshot':
            order = api.get('order/po/')[0]
            api.patch(f"order/po/{order['pk']}/", {field: value})
        return original(self, spec, context)
    monkeypatch.setattr(StockHandlers, 'run', drift)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert not [item for item in api.get('attachment/') if item['model_type'] == 'order.purchaseorder']
    relevant = [op for op in plan.operations if op.desired.values().get('target') == operation(plan, 'order').id]
    assert all(row(snapshot, op)['state'] == State.NEEDS_REVIEW for op in relevant)
    assert api.get('order/po/')[0][field] == value


@pytest.mark.parametrize('image', [False, True])
def test_transfer_acceptance_does_not_claim_unverified_remote_content(scene, tmp_path, monkeypatch, image):
    api = scene[0]
    doc = document(tmp_path)
    doc.lines = doc.lines[:1]
    (tmp_path / 'proof.png').write_bytes(b'approved bytes')
    if image:
        doc.lines[0].image = 'proof.png'
    else:
        doc.lines[0].attachments = [('proof.png', 'Proof')]
    plan = full(scene, doc, archive=False)
    original = api.request
    def corrupt(route, *, method, **kwargs):
        response = original(route, method=method, **kwargs)
        key = 'image' if image else 'attachment'
        if kwargs.get('files', {}).get(key, (None,))[0] == 'proof.png':
            with api.connect() as connection:
                connection.execute('UPDATE bytes SET content=?', (b'wrong remote bytes',))
        return response
    monkeypatch.setattr(api, 'request', corrupt)
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    evidence = operation(plan, 'evidence')
    assert row(snapshot, evidence)['state'] == State.NEEDS_REVIEW
    provenance = json.loads(artifact_path(run, operation(plan, 'provenance_snapshot').id).read_bytes())
    transfers = [change for change in provenance['changes'] if change['kind'] == 'upload']
    assert transfers and all(change['confirmed_fields'] == {} for change in transfers)
    assert transfers[0]['sent_content']['sha256'] == sha256(b'approved bytes').hexdigest()
    assert transfers[0]['certainty'] == 'confirmed'


@pytest.mark.parametrize('role', ['provenance', 'archive'])
@pytest.mark.parametrize('missing', [False, True])
def test_completed_resume_reports_retention_damage_without_replaying_remote_work(scene, tmp_path, role, missing):
    api = scene[0]
    plan = full(scene, document(tmp_path))
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    action = 'provenance_snapshot' if role == 'provenance' else 'evidence_archive'
    receipt = next(item for item in snapshot['prepared_artifacts'] if item['operation'] == operation(plan, action).id)
    path = run / 'artifacts' / receipt['filename']
    path.unlink() if missing else path.write_bytes(b'corrupt')
    with api.connect() as connection:
        sends = connection.execute('SELECT count(*) FROM calls').fetchone()[0]
    resumed = resume_stock(plan, snapshot['run_id'], run / 'run.sqlite3', api=api, current_target=TARGET)
    from invimport.execution.store import load_run_status
    assert not load_run_status(snapshot['run_id'])['retention']['complete']
    assert not resumed['report']['retention']['complete']
    status = next(item for item in resumed['report']['retention']['artifacts'] if item['operation'] == receipt['operation'])
    assert status['status'] == ('missing' if missing else 'corrupt')
    assert all(line['complete'] for line in resumed['report']['lines'])  # historical remote completion remains true
    with api.connect() as connection:
        assert connection.execute('SELECT count(*) FROM calls').fetchone()[0] == sends
    projected = project_stock_result(plan, resumed, run_directory=run)
    if role == 'provenance':
        assert projected.provenance.file is None
        assert status['status'] in projected.provenance.reason
    else:
        assert status['status'] in projected.archive.reason
        assert all(target.outcome == 'attached' for target in projected.archive.targets)


def test_verified_image_receipt_confirms_hash_without_inventing_remote_filename(scene, tmp_path):
    doc = document(tmp_path)
    (tmp_path / 'image.png').write_bytes(b'approved image')
    doc.lines[0].image = 'image.png'
    plan = full(scene, doc, archive=False)
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=run)
    receipts = [item for item in snapshot['artifact_transfers'] if item['event'] == 'evidence_verified'
                and item['operation'] == operation(plan, 'evidence').id]
    assert receipts and receipts[0]['sha256'] == sha256(b'approved image').hexdigest()
    assert 'filename' not in receipts[0]
    changes = json.loads(artifact_path(run, operation(plan, 'provenance_snapshot').id).read_bytes())['changes']
    upload = next(change for change in changes if change['kind'] == 'upload')
    assert upload['confirmed_fields'] == {'sha256': sha256(b'approved image').hexdigest()}


def test_genuinely_inapplicable_archive_lines_are_reported_unattached(scene, tmp_path):
    doc = document(tmp_path)
    for line in doc.lines:
        line.order, line.supplier, line.sku = {}, '', ''
    plan = full(scene, doc)
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    result = project_stock_result(plan, snapshot)
    assert result.archive.unattached == ['a', 'b']
    assert result.archive.targets == []
    assert not [op for op in plan.operations if op.desired.values().get('role') == 'archive']


def test_location_parser_handles_whitespace_and_ambiguous_raw_pathstrings(scene, tmp_path):
    api = scene[0]
    parent = api.seed('stock/location/', {'name': 'Bag', 'parent': None, 'pathstring': 'Bag'})
    wanted = api.seed('stock/location/', {'name': 'JM38510/10103BPC', 'parent': parent['pk'], 'pathstring': 'Bag/JM38510/10103BPC'})
    nested = api.seed('stock/location/', {'name': 'JM38510', 'parent': parent['pk'], 'pathstring': 'Bag/JM38510'})
    api.seed('stock/location/', {'name': '10103BPC', 'parent': nested['pk'], 'pathstring': 'Bag/JM38510/10103BPC'})
    doc = document(tmp_path)
    for line in doc.lines:
        line.location = r' Bag / JM38510\/10103BPC '
    plan = full(scene, doc, archive=False, provenance=False)
    execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert len(api.get('stock/location/')) == 5
    assert {stock['location'] for stock in api.get('stock/')} == {wanted['pk']}


def test_effective_default_location_is_frozen_for_stock_and_legacy_projection(scene, tmp_path):
    doc = document(tmp_path)
    for line in doc.lines:
        line.location = ''
    plan = full(scene, doc, default_location='Shelf', archive=False, provenance=False)
    assert plan.decisions.values()['line_inputs']['a']['location'] == 'Shelf'
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    assert all(line.location == 'Shelf' for line in project_stock_result(plan, snapshot).lines)


def test_generic_json_plan_keys_do_not_identify_owned_generated_material(scene, tmp_path):
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    paths = {'vendor-plan.json': {'plan_version': 1, 'lines': []},
             'vendor-workflow.json': {'schema_version': 1, 'operations': [], 'input_digest': 'vendor'}}
    for name, content in paths.items():
        (folder / name).write_text(json.dumps(content))
    plan = full(scene, doc)
    assert set(paths) <= {entry['name'] for entry in operation(plan, 'evidence_archive').desired.values()['manifest']}
