"""Full-library contracts against real journals and a persistent fake remote."""
from __future__ import annotations

import json
from dataclasses import replace

import pytest

from tests.execution.test_stock_workflow import TARGET, document, operation, row, scene as scene
from invimport.execution.models import Kind, Plan, State, validate_plan
from invimport.execution.stock_finalization import artifact_path
from invimport.execution.stock_preparation import PreparationReview
from invimport.execution.stock_workflow import execute_stock, prepare_full_stock, repair_stock, resume_stock
from invimport.inventree.stockimport import ImportOptions


def full(scene, doc, **options):
    api, categories, parameters = scene
    return prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=TARGET, options=ImportOptions(**options))


def test_complete_spec_and_maker_owned_parameters_notes_documents_and_provenance(scene, tmp_path):
    api, categories, parameters = scene
    categories['Resistors'].key_parameters = ['Resistance']
    doc = document(tmp_path, version=2)
    asset = tmp_path / 'label.txt'
    asset.write_bytes(b'original label')
    for line in doc.lines:
        line.manufacturer = 'Maker'
        line.mpn = 'R100'
        line.part_notes = 'Part research'
        line.manufacturer_part_notes = 'Maker research'
        line.notes = 'This lot only'
        line.attachments = [('label.txt', 'Label')]
    plan = full(scene, doc)
    assert not api.get('part/')
    assert plan.schema_version == 2
    assert Plan.loads(plan.dumps()).revision == plan.revision
    asset.unlink()  # retained preview content owns the subsequent local/remote work
    directory = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=directory)
    assert all(item['state'] in {State.SUCCEEDED, State.ALREADY_SATISFIED, State.SKIPPED} for item in snapshot['operations'])
    assert len(api.get('part/')) == len(api.get('company/part/manufacturer/')) == 1
    values = api.get('parameter/')
    assert len([value for value in values if value['model_type'] == 'part.part']) == 1
    assert len([value for value in values if value['model_type'] == 'company.manufacturerpart']) == 2
    assert len([value for value in values if value['model_type'] == 'company.supplierpart']) == 2
    assert api.get('part/')[0]['notes'] == 'Part research'
    assert api.get('company/part/manufacturer/')[0]['notes'] == 'Maker research'
    assert all(stock['notes'].startswith('This lot only') for stock in api.get('stock/'))
    provenance = operation(plan, 'provenance_snapshot')
    records = json.loads(artifact_path(directory, provenance.id).read_bytes())
    assert records['format'] == 'invimport-execution-provenance/1'
    assert any(change['model'] == 'part.part' and change['lines'] == ['a', 'b'] for change in records['changes'])
    before = len(api.get('attachment/'))
    resume_stock(plan, snapshot['run_id'], directory / 'run.sqlite3', api=api, current_target=TARGET)
    assert len(api.get('attachment/')) == before


def test_taxonomy_template_and_explicit_location_creation_are_visible(scene, tmp_path):
    api, categories, parameters = scene
    doc = document(tmp_path)
    for line in doc.lines:
        line.location = 'New/Shelf'
    with api.connect() as connection:
        connection.execute("DELETE FROM rows WHERE route IN ('part/category/','parameter/template/')")
    plan = full(scene, doc, archive=False, provenance=False)
    taxonomy = [op for op in plan.operations if op.desired.values()['action'] == 'taxonomy']
    assert len(taxonomy) == 5
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert all(line['complete'] for line in snapshot['report']['lines'])
    shelf = next(location for location in api.get('stock/location/') if location['name'] == 'Shelf' and location.get('parent'))
    assert {stock['location'] for stock in api.get('stock/')} == {shelf['pk']}


def test_mpn_matching_is_scoped_to_chosen_manufacturer(scene, tmp_path):
    api, categories, _ = scene
    categories['Resistors'].identity = 'mpn'
    makers = [api.seed('company/', {'name': name, 'is_manufacturer': True, 'is_supplier': False}) for name in ('Alpha', 'Beta')]
    parts = [api.seed('part/', {'name': name, 'IPN': name, 'category': api.get('part/category/')[0]['pk'], 'keywords': ''}) for name in ('Part Alpha', 'Part Beta')]
    for maker, part in zip(makers, parts, strict=True):
        api.seed('company/part/manufacturer/', {'MPN': '1234', 'manufacturer': maker['pk'], 'part': part['pk']})
    doc = document(tmp_path)
    for line in doc.lines:
        line.manufacturer = 'Beta'
        line.mpn = '1234'
    plan = full(scene, doc, provenance=False, archive=False)
    part = operation(plan, 'part')
    assert part.baseline.values()['pk'] == parts[1]['pk']
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert all(line['complete'] for line in snapshot['report']['lines'])
    assert {stock['part'] for stock in api.get('stock/')} == {parts[1]['pk']}




def test_plan_schema_one_bytes_and_ids_survive_new_settled_contract(scene, tmp_path):
    from invimport.execution.stock_preparation import prepare_stock
    api, categories, parameters = scene
    old = prepare_stock(document(tmp_path), api=api, categories=categories, parameters=parameters, target=TARGET)
    assert old.schema_version == 1
    raw = json.loads(old.dumps())
    assert all('settled_after' not in op for op in raw['operations'])
    assert Plan.loads(old.dumps()).dumps() == old.dumps()
    newer = full(scene, document(tmp_path), archive=False)
    assert any(op.settled_after for op in newer.operations)
    raw = json.loads(newer.dumps())
    raw['operations'][-1]['settled_after'] = 'bad'
    with pytest.raises(ValueError):
        Plan.loads(json.dumps(raw))
    loop = replace(newer.operations[0], settled_after=(newer.operations[-1].id,))
    with pytest.raises(ValueError, match='cyclic'):
        validate_plan(replace(newer, operations=(loop, *newer.operations[1:])))


def test_missing_location_with_creation_disabled_never_becomes_unlocated(scene, tmp_path):
    doc = document(tmp_path)
    doc.lines[0].location = 'Missing'
    with pytest.raises(PreparationReview, match='location'):
        full(scene, doc, create_locations=False)
    assert not scene[0].get('stock/')










def test_pdf_extraction_and_company_logo_original_eligibility_survive_repair(scene, tmp_path):
    from io import BytesIO
    from pypdf import PdfWriter
    api = scene[0]
    doc = document(tmp_path)
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_blank_page(width=200, height=200)
    buffer = BytesIO()
    writer.write(buffer)
    (tmp_path / 'book.pdf').write_bytes(buffer.getvalue())
    (tmp_path / 'logo.png').write_bytes(b'logo image')
    doc.companies = {'Maker': {'image': 'logo.png'}}
    for line in doc.lines:
        line.manufacturer = 'Maker'
        line.mpn = 'R100'
        line.datasheet = 'book.pdf'
        line.datasheet_pages = '2'
    plan = full(scene, doc, archive=False, provenance=False)
    assert any(op.desired.values()['action'] == 'asset_extract' for op in plan.operations)
    api.fail('company/', 'rejected')  # maker create; supplier and inventory remain blocked/reviewable
    run = tmp_path / 'run'
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=run)
    maker = next(op for op in plan.operations if op.kind == Kind.COMPANY and op.desired.values()['payload'].get('is_manufacturer'))
    repaired = repair_stock(plan, snapshot['run_id'], run / 'run.sqlite3', maker.id, api=api, current_target=TARGET)
    assert all(line['registered'] for line in repaired['report']['lines'])
    assert any(company.get('image') for company in api.get('company/') if company['name'] == 'Maker')
    assert any(item['filename'].endswith('-p2.pdf') for item in api.get('attachment/'))
    assert len(api.get('image/')) == 1
    # A later import's existing Maker is ineligible even if its logo was removed.
    maker_row = next(company for company in api.get('company/') if company['name'] == 'Maker')
    api.patch(f"company/{maker_row['pk']}/", {'image': None})
    later = full(scene, doc, archive=False, provenance=False)
    execute_stock(later, api=api, current_target=TARGET, run_directory=tmp_path / 'later')
    assert len(api.get('image/')) == 1




def test_legacy_projection_preserves_required_plan_fields(scene, tmp_path):
    from invimport.execution.stock_workflow import project_stock_result
    plan = full(scene, document(tmp_path), archive=False, provenance=False)
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    result = project_stock_result(plan, snapshot)
    assert result.counts()['created'] == 2
    assert [line.quantity for line in result.lines] == [10, 20]
    assert all(line.part and line.stock_item and line.supplier_part and line.purchase_order for line in result.lines)
    assert snapshot['report']['format'] == 'invimport-execution-report/1'
    from invimport.inventree.importplan import build_plan
    projection = build_plan(scene[0], document(tmp_path), result)
    assert projection['plan_version'] == 1
    assert len(projection['lines']) == 2


@pytest.mark.parametrize('options,expected_companies,expected_orders', [
    ({'create_manufacturers': False}, 1, 1),
    ({'create_suppliers': False}, 1, 0),
    ({'create_orders': False}, 2, 0),
])
def test_creation_flags_preserve_stock_scope(scene, tmp_path, options, expected_companies, expected_orders):
    doc = document(tmp_path)
    for line in doc.lines:
        line.manufacturer = 'Maker'
        line.mpn = 'R100'
    plan = full(scene, doc, archive=False, provenance=False, **options)
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    assert len(scene[0].get('company/')) == expected_companies
    assert len(scene[0].get('order/po/')) == expected_orders
    assert len(scene[0].get('stock/')) == 2
    assert all(line['registered'] for line in snapshot['report']['lines'])


def test_actual_observed_sdk_full_multipart_images_and_downloads_have_one_intent_per_send(scene, tmp_path):
    import sqlite3
    from urllib.parse import urlsplit
    from requests import HTTPError
    from tests.inventree.test_request_observation import Response
    from invimport.execution.dispatch import active_guard
    from invimport.execution.observation import Observation, observing
    from invimport.inventree.observed_api import client
    from invimport.inventree.stock import _http_failure
    server, categories, parameters = scene
    observation = Observation()
    class SDKResponse(Response):
        def json(self):
            return json.loads(self.text)
    class Transport:
        def __init__(self):
            self.sends = []
        def __getattr__(self, method):
            def send(url, **kwargs):
                path = urlsplit(url).path
                guard = active_guard()
                event = observation.snapshot()[-1]
                assert event.kind == 'request_started'
                if guard:
                    assert guard.store.connection.execute('SELECT state FROM requests WHERE id=?', (event.request,)).fetchone() == ('intent',)
                    self.sends.append((method, path, event.request))
                if path.startswith('/media/'):
                    with server.connect() as connection:
                        content = connection.execute('SELECT content FROM bytes WHERE pk=?', (int(path.rsplit('/', 1)[-1]),)).fetchone()[0]
                    response = SDKResponse(None)
                    response.content = content
                    response.headers = {'content-type': 'application/octet-stream'}
                    return response
                route = path.removeprefix('/api/')
                try:
                    if route == '':
                        return SDKResponse({'server': 'InvenTree', 'apiVersion': 530})
                    if route == 'user/me/':
                        return SDKResponse({'username': 'fixture'})
                    if method == 'get':
                        return SDKResponse(server.get(route, params=kwargs.get('params', {})))
                    if method == 'options':
                        return SDKResponse(server.request(route, method='OPTIONS').json())
                    if kwargs.get('files'):
                        response = server.request(route, method=method.upper(), data=kwargs.get('data', {}), files=kwargs['files'])
                        return SDKResponse({}, response.status_code)
                    if method == 'patch':
                        return SDKResponse(server.patch(route, kwargs['json']))
                    return SDKResponse(server.post(route, kwargs['json']), 201)
                except HTTPError as exc:
                    status, payload = _http_failure(exc)
                    return SDKResponse(payload, status)
            return send
    doc = document(tmp_path)
    (tmp_path / 'photo.png').write_bytes(b'photo')
    (tmp_path / 'logo.png').write_bytes(b'logo')
    doc.companies = {'Maker': {'image': 'logo.png'}}
    for line in doc.lines:
        line.manufacturer = 'Maker'
        line.mpn = 'R100'
        line.image = 'photo.png'
        line.stock_images = ['photo.png']
    transport = Transport()
    with observing(observation):
        api = client(TARGET.endpoint, observation=observation, transport=transport, token='fixture-token')
        plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters, target=TARGET)
        snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert all(line['complete'] for line in snapshot['report']['lines'])
    with sqlite3.connect(tmp_path / 'run' / 'run.sqlite3') as connection:
        requests = {row[0] for row in connection.execute('SELECT id FROM requests')}
    assert len(requests) == len(transport.sends) == len({send[2] for send in transport.sends})
    assert requests == {send[2] for send in transport.sends}
    assert any('/media/' in send[1] for send in transport.sends)
    assert any(send[0] == 'patch' and send[1].startswith('/api/company/') for send in transport.sends)




def test_shared_new_company_roles_create_one_company(scene, tmp_path):
    doc = document(tmp_path)
    for line in doc.lines:
        line.manufacturer = line.supplier
        line.mpn = 'R100'
    plan = full(scene, doc, archive=False, provenance=False)
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    assert len(scene[0].get('company/')) == 1
    assert all(line['registered'] for line in snapshot['report']['lines'])
    company = scene[0].get('company/')[0]
    assert company['is_manufacturer'] and company['is_supplier']


def test_frozen_mpn_choice_revalidates_relationship_before_part_create(scene, tmp_path):
    api, categories, _ = scene
    categories['Resistors'].identity = 'mpn'
    maker = api.seed('company/', {'name': 'Maker', 'is_manufacturer': True, 'is_supplier': False})
    doc = document(tmp_path)
    for line in doc.lines:
        line.manufacturer, line.mpn = 'Maker', '1234'
    plan = full(scene, doc, archive=False, provenance=False)
    other = api.seed('part/', {'name': 'Concurrent Part', 'IPN': 'OTHER', 'category': api.get('part/category/')[0]['pk'], 'keywords': ''})
    api.seed('company/part/manufacturer/', {'part': other['pk'], 'manufacturer': maker['pk'], 'MPN': '1234'})
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert row(snapshot, operation(plan, 'part'))['state'] == State.NEEDS_REVIEW
    assert len(api.get('part/')) == 1
    assert not api.get('stock/')


def test_confidence_and_partial_skip_are_frozen_line_outcomes_with_independent_continuation(scene, tmp_path):
    from invimport.execution.stock_workflow import project_stock_result
    doc = document(tmp_path)
    doc.lines[0].confidence = 0.1
    plan = full(scene, doc, min_confidence=0.9, archive=False, provenance=False)
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'confidence')
    assert len(scene[0].get('stock/')) == 1
    assert project_stock_result(plan, snapshot).lines[0].action == 'review'
    assert snapshot['report']['lines'][1]['registered']
    # A distinct approved input selects skip for incomplete specifications.
    other = document(tmp_path)
    other.source['reference'] = 'partial-skip'
    other.file_id = 'partial-skip'
    other.lines[0].parameters.pop('Tolerance')
    plan = full(scene, other, on_partial='skip', archive=False, provenance=False)
    assert operation(plan, 'line_disposition').desired.values()['outcome'] == 'skip'


def test_callbacks_finish_in_preparation_and_selected_name_is_preserved(scene, tmp_path):
    api, categories, _ = scene
    categories['Resistors'].identity = 'mpn'
    existing = api.seed('part/', {'name': '1234', 'IPN': 'EXISTING', 'keywords': '', 'category': api.get('part/category/')[0]['pk']})
    doc = document(tmp_path)
    for line in doc.lines:
        line.mpn, line.name, line.confidence = '1234', 'File display name', 0.1
    calls = []
    def choose(line, rows):
        calls.append(('name', line.id))
        return rows[0]
    def confirm(line, action):
        calls.append(('confirm', line.id))
        return True
    plan = full(scene, doc, choose_name_match=choose, confirm_line=confirm, min_confidence=0.9,
                archive=False, provenance=False)
    count = len(calls)
    snapshot = execute_stock(plan, api=api, current_target=TARGET, run_directory=tmp_path / 'run')
    assert len(calls) == count
    assert all(line['registered'] for line in snapshot['report']['lines'])
    assert len(api.get('part/')) == 1 and api.get('part/')[0]['name'] == '1234'
    assert operation(plan, 'part').baseline.values()['pk'] == existing['pk']


@pytest.mark.parametrize('model,route', [('company.manufacturerpart', 'company/part/manufacturer/'), ('stock.stocklocation', 'stock/location/')])
def test_new_domain_checkpoint_survives_fresh_process_without_recreating(scene, tmp_path, model, route):
    import os
    import sqlite3
    import subprocess
    import sys
    api = scene[0]
    doc = document(tmp_path)
    for line in doc.lines:
        line.manufacturer, line.mpn = 'Maker', '1234'
        if model == 'stock.stocklocation':
            line.location = 'New location'
    plan = full(scene, doc, archive=False, provenance=False)
    saved = tmp_path / 'checkpoint-plan.json'
    saved.write_text(plan.dumps())
    run = tmp_path / 'run'
    code = '''
import os, sys
from pathlib import Path
from tests.execution.stock_server import StockServer
from tests.execution.test_stock_workflow import TARGET
from invimport.execution.models import Plan
from invimport.execution.store import RunStore
from invimport.execution.stock_workflow import execute_stock
original = RunStore.checkpoint
def checkpoint(self, attempt, result):
    original(self, attempt, result)
    if any(output.model == sys.argv[4] for output in result.outputs):
        os._exit(88)
RunStore.checkpoint = checkpoint
plan = Plan.loads(Path(sys.argv[1]).read_text())
execute_stock(plan, api=StockServer(Path(sys.argv[2])), current_target=TARGET, run_directory=Path(sys.argv[3]))
'''
    child = subprocess.run([sys.executable, '-c', code, str(saved), str(api.path), str(run), model], env=os.environ.copy())
    assert child.returncode == 88
    before = len(api.get(route))
    with sqlite3.connect(run / 'run.sqlite3') as connection:
        run_id = connection.execute('SELECT id FROM run').fetchone()[0]
    resumed = resume_stock(plan, run_id, run / 'run.sqlite3', api=api, current_target=TARGET)
    affected = next(op for op in plan.operations if op.desired.values().get('model') == model
                    or model == 'company.manufacturerpart' and op.desired.values()['action'] == 'manufacturer_part')
    repaired = repair_stock(plan, run_id, run / 'run.sqlite3', affected.id, api=api, current_target=TARGET)
    assert len(api.get(route)) == before
    assert all(line['registered'] for line in repaired['report']['lines'])
    assert resumed['revision'] == repaired['revision'] == plan.revision










def test_approximate_quantity_uses_shared_notes_policy_without_inventing_api_fields(scene, tmp_path, monkeypatch):
    doc = document(tmp_path)
    doc.lines[0].approximate = True
    plan = full(scene, doc, archive=False, provenance=False)
    payload = operation(plan, 'stock').desired.values()['payload']
    assert set(payload) == {'quantity', 'status', 'batch', 'packaging', 'location'}
    sends = []
    original = scene[0].post
    def capture(route, body):
        if route == 'stock/':
            sends.append(dict(body))
        return original(route, body)
    monkeypatch.setattr(scene[0], 'post', capture)
    snapshot = execute_stock(plan, api=scene[0], current_target=TARGET, run_directory=tmp_path / 'run')
    assert snapshot['report']['lines'][0]['registered']
    assert 'Quantity is approximate' in scene[0].get('stock/')[0]['notes']
    # Exact public create fields also used by legacy add_stock. Approximation
    # is a note policy, not an assumed target serializer extension.
    assert set(sends[0]) == set(payload) | {'part', 'supplier_part'}
    assert sends[0]['quantity'] == doc.lines[0].quantity
