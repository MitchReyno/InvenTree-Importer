"""Real CLI contracts with persistent fake inventory and fresh local processes."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from invimport.__main__ import cli
from invimport.commands import import_run
from invimport.execution.observation import Observation, observing
from invimport.execution.run_control import InvocationFailure, inspect_run
from invimport.execution.stock_workflow import execute_stock, prepare_full_stock
from invimport.execution.models import Target
from invimport.inventree.stockimport import ImportOptions
from tests.execution.test_stock_workflow import document, operation, scene as scene


def prepared(scene, tmp_path):
    api, categories, parameters = scene
    doc = document(tmp_path)
    plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=Target(api.api_url), options=ImportOptions(archive=False, provenance=False))
    path = tmp_path / 'approved.json'
    path.write_text(plan.dumps())
    return api, doc, plan, path


def invoke_process(arguments, api, tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = '''import sys
from pathlib import Path
from invimport.commands import import_run
from invimport.__main__ import cli
from tests.execution.stock_server import StockServer
server_path = Path(sys.argv.pop(1))
import_run.connect = lambda: StockServer(server_path)
sys.exit(cli(sys.argv[1:]))
'''
    env = dict(os.environ, PYTHONPATH=os.pathsep.join((str(root), str(root / 'src'))),
               INVENTREE_URL=api.api_url)
    return subprocess.run([sys.executable, '-c', script, str(api.path), '--env-file', str(tmp_path / 'absent.env'),
                           'import-run', *arguments], env=env, text=True, capture_output=True, check=False)


def test_fresh_process_execute_status_preview_and_retained_source_deletion(scene, tmp_path):
    api, doc, plan, path = prepared(scene, tmp_path)
    doc.path.unlink()
    dry = invoke_process(['execute', str(path), '--json'], api, tmp_path)
    assert dry.returncode == 0 and json.loads(dry.stdout)['preview_only']
    assert not api.get('stock/')
    events = tmp_path / 'events.jsonl'
    run = invoke_process(['execute', str(path), '--write', '--json', '--events', str(events)], api, tmp_path)
    assert run.returncode == 0, run.stderr
    snapshot = json.loads(run.stdout)
    assert 'Resolved plan' in run.stderr and 'operation_started' in run.stderr
    assert len(api.get('stock/')) == 2
    exported = [json.loads(line) for line in events.read_text().splitlines()]
    assert [event['sequence'] for event in exported] == list(range(1, len(exported) + 1))
    assert len({event['stream'] for event in exported}) == 1
    assert all(event['format'] == 'invimport-observation/1' for event in exported)
    # Rebuild state after dropping every UI event, in a separate process.
    status = invoke_process(['status', snapshot['run_id'], '--json'], api, tmp_path)
    result = json.loads(status.stdout)
    assert status.returncode == 0 and result['complete']
    assert result['attempts'] and result['requests']
    assert result['sequence'] > 0


def test_cli_prepare_read_only_and_outline_precedes_connect(scene, tmp_path, monkeypatch, capsys):
    api, categories, parameters = scene
    doc = document(tmp_path)
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    monkeypatch.setattr(import_run, 'load_categories_config', lambda _: categories)
    monkeypatch.setattr(import_run, 'load_parameters_config', lambda _: parameters)
    def connect():
        assert 'validate local input' in capsys.readouterr().err
        return api
    monkeypatch.setattr(import_run, 'connect', connect)
    output = tmp_path / 'plan.json'
    assert cli(['import-run', 'prepare', str(doc.path), '--output', str(output), '--no-archive', '--json']) == 0
    result = json.loads(capsys.readouterr().out)
    assert result['prepared'] and output.stat().st_mode & 0o777 == 0o600
    assert not api.get('stock/')


def test_status_and_abandon_are_local_and_tombstone_blocks_new_write(scene, tmp_path, monkeypatch, capsys):
    api, _, plan, path = prepared(scene, tmp_path)
    api.fail('stock/', 'lost')
    initial = execute_stock(plan, api=api, current_target=plan.target, run_directory=tmp_path / 'custom')
    monkeypatch.setattr(import_run, 'connect', lambda: pytest.fail('local command connected'))
    assert cli(['import-run', 'status', initial['run_id'], '--json']) == 1
    json.loads(capsys.readouterr().out)
    assert cli(['import-run', 'abandon', initial['run_id'], '--reason', 'reviewed unresolved write; retain blocking claim', '--write', '--json']) == 1
    result = json.loads(capsys.readouterr().out)
    assert result['disposition'] == 'abandoned'
    assert any(row['state'] == 'uncertain' for row in result['operations'])
    attempt = invoke_process(['execute', str(path), '--write', '--json'], api, tmp_path)
    assert attempt.returncode == 1
    assert json.loads(attempt.stdout)['error'] == 'OwnershipError'


def test_target_and_continuity_checks_precede_connection(scene, tmp_path, monkeypatch, capsys):
    api, _, plan, path = prepared(scene, tmp_path)
    api.fail('stock/', 'rejected')
    initial = execute_stock(plan, api=api, current_target=plan.target, run_directory=tmp_path / 'run')
    monkeypatch.setattr(import_run, 'connect', lambda: pytest.fail('must not connect'))
    monkeypatch.setenv('INVENTREE_URL', 'https://other.invalid/')
    assert cli(['import-run', 'execute', str(path), '--write', '--json']) == 1
    assert json.loads(capsys.readouterr().out)['error'] == 'ValueError'
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    assert cli(['import-run', 'resume', initial['run_id'], '--write', '--yes', '--json']) == 1
    assert json.loads(capsys.readouterr().out)['error'] == 'ValueError'


def test_retry_recovers_only_usable_prerequisites_not_settled_inventory(scene, tmp_path):
    api, _, plan, path = prepared(scene, tmp_path)
    api.fail('part/', 'rejected')
    run = invoke_process(['execute', str(path), '--write', '--json'], api, tmp_path)
    snapshot = json.loads(run.stdout)
    barcode = operation(plan, 'barcode')
    retried = invoke_process(['retry-operation', snapshot['run_id'], barcode.id, '--write',
                              '--continuity-reason', 'same test database retained across process exit', '--json'], api, tmp_path)
    assert retried.returncode == 0, retried.stderr
    assert len(api.get('part/')) == 1 and len(api.get('stock/')) == 2
    assert inspect_run(snapshot['run_id'])['complete']


def test_renderer_failure_library_quiet_and_snapshot_reconstruction(scene, tmp_path, capsys):
    api, _, plan, _ = prepared(scene, tmp_path)
    def broken(_):
        raise OSError('render-secret-canary')
    observation = Observation(broken)
    with observing(observation):
        snapshot = execute_stock(plan, api=api, current_target=plan.target, run_directory=tmp_path / 'run')
    assert observation.delivery_failures
    assert len(api.get('stock/')) == 2
    assert inspect_run(snapshot['run_id'])['complete']
    assert capsys.readouterr() == ('', '')


def test_unexpected_failure_preserves_cause_and_machine_error_redacts(scene, tmp_path, monkeypatch, capsys):
    api, _, _, path = prepared(scene, tmp_path)
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    def broken():
        raise RuntimeError('token-password-header-canary')
    monkeypatch.setattr(import_run, 'connect', broken)
    args = __import__('invimport.__main__', fromlist=['build_parser']).build_parser().parse_args(
        ['import-run', 'execute', str(path), '--write', '--json'])
    with pytest.raises(InvocationFailure) as error:
        import_run.run(args)
    assert isinstance(error.value.__cause__, RuntimeError)
    captured = capsys.readouterr()
    assert 'token-password-header-canary' not in captured.out + captured.err
    assert json.loads(captured.out)['error'] == 'RuntimeError'


def test_missing_or_corrupt_registry_fails_closed_in_fresh_process(scene, tmp_path):
    api, _, _, path = prepared(scene, tmp_path)
    run = invoke_process(['execute', str(path), '--write', '--json'], api, tmp_path)
    run_id = json.loads(run.stdout)['run_id']
    registry = Path(os.environ['INVIMPORT_STATE_DIR']) / 'execution' / 'registry.sqlite3'
    registry.write_bytes(b'corrupt')
    result = invoke_process(['status', run_id, '--json'], api, tmp_path)
    assert result.returncode == 1 and json.loads(result.stdout)['error'] == 'JournalError'


@pytest.mark.parametrize('credentials', [
    {'token': 'token-secret-canary'},
    {'username': 'username-secret-canary', 'password': 'password-secret-canary'},
])
def test_actual_sdk_cli_preparation_and_execute_with_safe_auth_events(
        scene, tmp_path, monkeypatch, capsys, credentials):
    from urllib.parse import urlsplit
    from invimport.execution.dispatch import active_guard
    from invimport.execution.observation import active
    from invimport.inventree.observed_api import client
    from tests.inventree.test_request_observation import Response as BaseResponse

    class Response(BaseResponse):
        def json(self):
            return json.loads(self.text)

    api, categories, parameters = scene
    doc = document(tmp_path)
    sends = []

    class Transport:
        def __getattr__(self, method):
            def send(url, **kwargs):
                sends.append((method, url))
                route = urlsplit(url).path.split('/api/', 1)[1]
                guard = active_guard()
                if guard:
                    pending = guard.store.connection.execute("SELECT state FROM requests ORDER BY rowid DESC LIMIT 1").fetchone()
                    assert pending == ('intent',)
                if not route:
                    return Response({'server': 'InvenTree', 'apiVersion': 530})
                if route.startswith('user/me'):
                    return Response({'username': 'username-secret-canary'})
                if route.startswith('user/token'):
                    return Response({'token': 'token-secret-canary'})
                if method == 'options':
                    value = api.request(route, method='OPTIONS')
                    return Response(value.json())
                if method == 'get':
                    return Response(api.get(route, params=kwargs.get('params')))
                if method in {'post', 'patch'}:
                    value = getattr(api, method)(route, kwargs.get('json') or kwargs.get('data'))
                    return Response(value, 201 if method == 'post' else 200)
                raise AssertionError(method)
            return send

    def connected():
        return client(api.api_url, observation=active(), transport=Transport(), **credentials)
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    monkeypatch.setattr(import_run, 'connect', connected)
    monkeypatch.setattr(import_run, 'load_categories_config', lambda _: categories)
    monkeypatch.setattr(import_run, 'load_parameters_config', lambda _: parameters)
    path = tmp_path / 'sdk-plan.json'
    events = tmp_path / 'sdk-events.jsonl'
    assert cli(['import-run', 'prepare', str(doc.path), '--output', str(path),
                '--no-archive', '--no-provenance', '--events', str(events), '--json']) == 0
    first = capsys.readouterr()
    json.loads(first.out)
    assert cli(['import-run', 'execute', str(path), '--write', '--events', str(events), '--json']) == 0
    second = capsys.readouterr()
    snapshot = json.loads(second.out)
    inspection = inspect_run(snapshot['run_id'])
    assert inspection['complete'] and len(inspection['requests']) > 0
    combined = first.out + first.err + second.out + second.err + events.read_text()
    for canary in ('token-secret-canary', 'username-secret-canary', 'password-secret-canary'):
        assert canary not in combined
    assert len(api.get('stock/')) == 2


def test_selected_optional_failure_is_incomplete_but_disabled_is_complete(scene, tmp_path):
    api, categories, parameters = scene
    doc = document(tmp_path)
    plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=Target(api.api_url), options=ImportOptions(archive=True, provenance=True))
    path = tmp_path / 'with-evidence.json'
    path.write_text(plan.dumps())
    api.fail('attachment/', 'rejected')
    run = invoke_process(['execute', str(path), '--write', '--json'], api, tmp_path)
    result = json.loads(run.stdout)
    assert run.returncode == 1
    assert len(api.get('stock/')) == 2
    assert any(row['state'] not in {'succeeded', 'already_satisfied', 'skipped'} for row in result['operations'])
    uploads = [op for op in plan.operations if op.desired.values()['action'] == 'artifact_upload']
    selected = next(op for op in uploads if any(row['id'] == op.id and row['state'] not in {'succeeded', 'already_satisfied'} for row in result['operations']))
    retried = invoke_process(['retry-operation', result['run_id'], selected.id, '--write',
                              '--continuity-reason', 'reviewed same database and saved recipients', '--json'], api, tmp_path)
    assert retried.returncode == 0, retried.stderr
    assert len(api.get('stock/')) == 2


def test_completed_retention_damage_has_no_remote_calls(scene, tmp_path):
    api, categories, parameters = scene
    doc = document(tmp_path)
    plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=Target(api.api_url), options=ImportOptions(archive=True, provenance=True))
    snapshot = execute_stock(plan, api=api, current_target=plan.target, run_directory=tmp_path / 'run')
    receipt = snapshot['prepared_artifacts'][0]
    (tmp_path / 'run' / 'artifacts' / receipt['filename']).write_bytes(b'corrupt')
    with api.connect() as connection:
        before = connection.execute('SELECT count(*) FROM calls').fetchone()[0]
    status = invoke_process(['status', snapshot['run_id'], '--json'], api, tmp_path)
    assert status.returncode == 1 and not json.loads(status.stdout)['retention']['complete']
    resumed = invoke_process(['resume', snapshot['run_id'], '--write', '--continuity-reason',
                              'same database; only retained local artifact corrupted', '--json'], api, tmp_path)
    assert resumed.returncode == 1
    with api.connect() as connection:
        assert connection.execute('SELECT count(*) FROM calls').fetchone()[0] == before


def test_selecting_evidence_does_not_retry_failed_settled_inventory(scene, tmp_path):
    api, categories, parameters = scene
    doc = document(tmp_path)
    plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=Target(api.api_url), options=ImportOptions())
    path = tmp_path / 'plan.json'
    path.write_text(plan.dumps())
    api.fail('stock/', 'rejected')
    api.fail('attachment/', 'rejected')
    run = invoke_process(['execute', str(path), '--write', '--json'], api, tmp_path)
    snapshot = json.loads(run.stdout)
    assert len(api.get('stock/')) == 1
    upload = next(op for op in plan.operations if op.desired.values()['action'] == 'artifact_upload'
                  and any(row['id'] == op.id and row['state'] not in {'succeeded', 'already_satisfied'} for row in snapshot['operations']))
    result = invoke_process(['retry-operation', snapshot['run_id'], upload.id, '--write',
                             '--continuity-reason', 'same database; selected pending archive only', '--json'], api, tmp_path)
    assert result.returncode == 1  # Failed inventory remains honestly incomplete.
    assert len(api.get('stock/')) == 1


def test_keyboard_interrupt_stops_and_keeps_local_run_identity(scene, tmp_path, monkeypatch, capsys):
    api, _, _, path = prepared(scene, tmp_path)
    original = api.post
    def interrupted(route, payload):
        if route == 'stock/':
            original(route, payload)
            raise KeyboardInterrupt()
        return original(route, payload)
    monkeypatch.setattr(api, 'post', interrupted)
    monkeypatch.setattr(import_run, 'connect', lambda: api)
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    assert cli(['import-run', 'execute', str(path), '--write', '--json']) == 130
    result = json.loads(capsys.readouterr().out)
    status = inspect_run(result['run_id'])
    assert not status['complete']
    assert len(api.get('stock/')) == 1
    assert any(row['state'] == 'uncertain' for row in status['operations'])


def test_programming_error_after_mutation_retains_cause_run_and_stops(scene, tmp_path, monkeypatch, capsys):
    api, _, _, path = prepared(scene, tmp_path)
    original = api.post
    def broken(route, payload):
        if route == 'stock/':
            original(route, payload)
            raise RuntimeError('unsafe-token-error-canary')
        return original(route, payload)
    monkeypatch.setattr(api, 'post', broken)
    monkeypatch.setattr(import_run, 'connect', lambda: api)
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    assert cli(['import-run', 'execute', str(path), '--write', '--json']) == 1
    captured = capsys.readouterr()
    assert 'unsafe-token-error-canary' not in captured.out + captured.err
    status = inspect_run(json.loads(captured.out)['run_id'])
    assert not status['complete'] and len(api.get('stock/')) == 1


def test_semantically_corrupt_journal_fails_closed(scene, tmp_path):
    import sqlite3
    api, _, plan, _ = prepared(scene, tmp_path)
    snapshot = execute_stock(plan, api=api, current_target=plan.target, run_directory=tmp_path / 'run')
    with sqlite3.connect(tmp_path / 'run' / 'run.sqlite3') as connection:
        connection.execute("UPDATE operations SET result=NULL WHERE state='succeeded'")
    result = invoke_process(['status', snapshot['run_id'], '--json'], api, tmp_path)
    assert result.returncode == 1 and json.loads(result.stdout)['error'] == 'JournalError'


def test_preparation_excludes_only_explicit_generated_destinations(scene, tmp_path, monkeypatch, capsys):
    api, categories, parameters = scene
    folder = tmp_path / "fixture"
    folder.mkdir()
    doc = document(folder)
    output = folder / 'plan.json'
    events = folder / 'events.jsonl'
    output.write_text('partial previous generated output')
    events.write_text('partial previous generated events')
    genuine = folder / 'vendor.jsonl'
    genuine.write_text('legitimate source evidence')
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    monkeypatch.setattr(import_run, 'connect', lambda: api)
    monkeypatch.setattr(import_run, 'load_categories_config', lambda _: categories)
    monkeypatch.setattr(import_run, 'load_parameters_config', lambda _: parameters)
    assert cli(['import-run', 'prepare', str(doc.path), '--output', str(output), '--events', str(events), '--json']) == 0
    json.loads(capsys.readouterr().out)
    from invimport.execution.models import Plan
    plan = Plan.loads(output.read_text())
    archive = next(op for op in plan.operations if op.desired.values()['action'] == 'evidence_archive')
    names = {item['name'] for item in archive.desired.values()['manifest']}
    assert 'plan.json' not in names and 'events.jsonl' not in names
    assert 'vendor.jsonl' in names


def test_ambiguous_preparation_json_is_single_object_without_prompts(scene, tmp_path, monkeypatch, capsys):
    api, categories, parameters = scene
    doc = document(tmp_path)
    api.seed('company/', {'name': 'Supplier', 'is_supplier': True})
    api.seed('company/', {'name': 'Supplier', 'is_supplier': True})
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    monkeypatch.setattr(import_run, 'connect', lambda: api)
    monkeypatch.setattr(import_run, 'load_categories_config', lambda _: categories)
    monkeypatch.setattr(import_run, 'load_parameters_config', lambda _: parameters)
    assert cli(['import-run', 'prepare', str(doc.path), '--output', str(tmp_path / 'plan.json'), '--json']) == 1
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result['error'] == 'PreparationReview'
    assert 'explicit record choice required' in result['message']
    assert not api.get('stock/')


@pytest.mark.parametrize('failing_route', ['user/token/', 'user/me/'])
def test_actual_sdk_auth_errors_keep_credentials_out_of_cli_and_events(
        scene, tmp_path, monkeypatch, capsys, failing_route):
    from invimport.execution.observation import active
    from invimport.inventree.observed_api import client
    from tests.inventree.test_request_observation import Response
    import requests
    api, _, _, path = prepared(scene, tmp_path)
    class Transport:
        def __getattr__(self, method):
            def send(url, **kwargs):
                if failing_route in url:
                    raise requests.Timeout('Authorization: Bearer token-header-secret-canary')
                if url.endswith('/api/'):
                    return Response({'server': 'InvenTree', 'apiVersion': 530})
                if 'user/token/' in url:
                    return Response({'token': 'token-header-secret-canary'})
                return Response({'username': 'user-secret-canary'})
            return send
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    monkeypatch.setattr(import_run, 'connect', lambda: client(api.api_url, observation=active(), transport=Transport(),
                                                            username='user-secret-canary', password='password-secret-canary'))
    events = tmp_path / 'failed-auth.jsonl'
    assert cli(['import-run', 'execute', str(path), '--write', '--events', str(events), '--json']) == 1
    captured = capsys.readouterr()
    json.loads(captured.out)
    output = captured.out + captured.err + events.read_text()
    for canary in ('token-header-secret-canary', 'user-secret-canary', 'password-secret-canary'):
        assert canary not in output
    assert not api.get('stock/')


def test_full_cli_archive_and_attachment_use_frozen_bytes_after_source_deletion(scene, tmp_path):
    api, categories, parameters = scene
    folder = tmp_path / 'fixture'
    folder.mkdir()
    doc = document(folder)
    asset = folder / 'label.txt'
    asset.write_bytes(b'approved retained label')
    doc.lines[0].attachments = [('label.txt', 'Label')]
    plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=Target(api.api_url), options=ImportOptions())
    path = tmp_path / 'retained-plan.json'
    path.write_text(plan.dumps())
    asset.unlink()
    doc.path.unlink()
    folder.rmdir()
    run = invoke_process(['execute', str(path), '--write', '--json'], api, tmp_path)
    assert run.returncode == 0, run.stderr
    assert len(api.get('stock/')) == 2
    snapshot = json.loads(run.stdout)
    assert snapshot['retention']['complete']
    assert api.get('attachment/')


def test_event_export_failure_reports_incomplete_without_replaying_writes(scene, tmp_path, monkeypatch, capsys):
    api, _, _, path = prepared(scene, tmp_path)
    events = tmp_path / 'events.jsonl'
    atomic = import_run._atomic
    def fail_events(destination, content):
        if destination == events:
            raise OSError('event-export-secret-canary')
        atomic(destination, content)
    monkeypatch.setattr(import_run, '_atomic', fail_events)
    monkeypatch.setattr(import_run, 'connect', lambda: api)
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    assert cli(['import-run', 'execute', str(path), '--write', '--events', str(events), '--json']) == 1
    captured = capsys.readouterr()
    assert 'event-export-secret-canary' not in captured.out + captured.err
    snapshot = json.loads(captured.out)
    assert snapshot['events_saved'] is False
    assert inspect_run(snapshot['run_id'])['complete']
    assert len(api.get('stock/')) == 2


def test_events_cannot_replace_held_run_lock_or_retained_artifact(scene, tmp_path):
    from invimport.execution.ownership import FileLock, OwnershipError
    api, categories, parameters = scene
    doc = document(tmp_path)
    plan = prepare_full_stock(doc, api=api, categories=categories, parameters=parameters,
                              target=Target(api.api_url), options=ImportOptions())
    directory = tmp_path / 'custom-run'
    snapshot = execute_stock(plan, api=api, current_target=plan.target, run_directory=directory)
    lock = directory / 'run.lock'
    with FileLock(lock):
        inode = lock.stat().st_ino
        rejected = invoke_process(['status', snapshot['run_id'], '--events', str(lock), '--json'], api, tmp_path)
        assert rejected.returncode == 1
        assert json.loads(rejected.stdout)['error'] == 'unsafe_output_destination'
        assert lock.stat().st_ino == inode
        with pytest.raises(OwnershipError):
            with FileLock(lock):
                pytest.fail('original lock was bypassed')
    receipt = snapshot['prepared_artifacts'][0]
    artifact = directory / 'artifacts' / receipt['filename']
    original = artifact.read_bytes()
    rejected = invoke_process(['status', snapshot['run_id'], '--events', str(artifact), '--json'], api, tmp_path)
    assert rejected.returncode == 1 and artifact.read_bytes() == original
    assert inspect_run(snapshot['run_id'])['complete']


def test_output_guard_protects_registered_run_without_marker_and_canonical_locks(scene, tmp_path):
    from invimport.execution.ownership import state_root
    api, _, plan, path = prepared(scene, tmp_path)
    directory = tmp_path / 'custom-run'
    snapshot = execute_stock(plan, api=api, current_target=plan.target, run_directory=directory)
    (directory / '.invimport-run').unlink()
    targets = [directory / 'new-export.jsonl', directory / 'run.sqlite3-wal',
               state_root() / 'execution' / 'registry.lock',
               state_root() / 'execution' / 'registry.sqlite3-journal']
    for target in targets:
        existed = target.exists()
        original = target.read_bytes() if existed else None
        rejected = invoke_process(['status', snapshot['run_id'], '--events', str(target), '--json'], api, tmp_path)
        assert rejected.returncode == 1 and json.loads(rejected.stdout)['error'] == 'unsafe_output_destination'
        assert target.read_bytes() == original if existed else not target.exists()
    # The basename is not a policy: this unrelated destination remains allowed.
    allowed = invoke_process(['status', snapshot['run_id'], '--events', str(tmp_path / 'run.lock'), '--json'], api, tmp_path)
    assert allowed.returncode == 0
    assert (tmp_path / 'run.lock').read_text().strip() == ''  # status makes no API observations


def test_output_guard_protects_marked_unregistered_and_new_run_directories(scene, tmp_path):
    from invimport.execution.artifacts import initialize_run_directory
    api, _, _, path = prepared(scene, tmp_path)
    marked = tmp_path / 'marked-run'
    initialize_run_directory(marked)
    for destination, extra in ((marked / 'artifacts' / 'event.jsonl', []),
                                (tmp_path / 'future-run' / 'events.jsonl', ['--run-directory', str(tmp_path / 'future-run')])):
        rejected = invoke_process(['execute', str(path), '--events', str(destination), '--write', '--json', *extra], api, tmp_path)
        assert rejected.returncode == 1 and json.loads(rejected.stdout)['error'] == 'unsafe_output_destination'
        assert not destination.exists()
    assert not api.get('stock/')


@pytest.mark.parametrize('destination_kind', ['image', 'provenance', 'config', 'env', 'input'])
def test_prepare_outputs_cannot_overwrite_explicit_sources_or_configuration(
        scene, tmp_path, monkeypatch, capsys, destination_kind):
    api, categories, parameters = scene
    doc = document(tmp_path)
    source = tmp_path / 'source.txt'
    source.write_bytes(b'approved source bytes')
    payload = json.loads(doc.path.read_text())
    payload['lines'][0]['image'] = source.name
    payload['lines'][0]['provenance'] = [{'kind': 'document', 'file': source.name, 'facts': ['type']}]
    doc.path.write_text(json.dumps(payload))
    config = tmp_path / 'selected-config'
    config.mkdir()
    config_file = config / 'categories.yaml'
    config_file.write_bytes(b'configuration bytes')
    env_file = tmp_path / 'input.env'
    env_file.write_text('INVENTREE_TOKEN=credential-canary\n')
    destination = {'image': source, 'provenance': source, 'config': config_file, 'env': env_file, 'input': doc.path}[destination_kind]
    if destination_kind == 'provenance':
        payload['lines'][0].pop('image')
        doc.path.write_text(json.dumps(payload))
    before = destination.read_bytes()
    monkeypatch.setattr(import_run, 'connect', lambda: pytest.fail('unsafe output must fail before connection'))
    monkeypatch.setattr(import_run, 'load_categories_config', lambda _: categories)
    monkeypatch.setattr(import_run, 'load_parameters_config', lambda _: parameters)
    assert cli(['--env-file', str(env_file), 'import-run', 'prepare', str(doc.path), '--config', str(config),
                '--output', str(tmp_path / 'plan.json'), '--events', str(destination), '--json']) == 1
    result = json.loads(capsys.readouterr().out)
    assert result.get('events_saved') is False or result['error'] == 'unsafe_output_destination'
    assert destination.read_bytes() == before
    assert not api.get('stock/')


def test_cancelled_write_retains_exit130_when_event_export_fails(scene, tmp_path, monkeypatch, capsys):
    api, _, _, path = prepared(scene, tmp_path)
    original = api.post
    def interrupted(route, payload):
        result = original(route, payload)
        if route == 'stock/':
            raise KeyboardInterrupt()
        return result
    monkeypatch.setattr(api, 'post', interrupted)
    monkeypatch.setattr(import_run, 'connect', lambda: api)
    monkeypatch.setattr(import_run, '_atomic', lambda *args: (_ for _ in ()).throw(OSError('disk full')))
    monkeypatch.setenv('INVENTREE_URL', api.api_url)
    assert cli(['import-run', 'execute', str(path), '--write', '--events', str(tmp_path / 'events.jsonl'), '--json']) == 130
    result = json.loads(capsys.readouterr().out)
    assert result['error'] == 'cancelled' and result['events_saved'] is False
    assert any(row['state'] == 'uncertain' for row in inspect_run(result['run_id'])['operations'])
    assert len(api.get('stock/')) == 1
