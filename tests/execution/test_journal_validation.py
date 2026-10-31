"""Corruption is distinct from valid checkpoint and blocked-read transitions."""
from __future__ import annotations

from dataclasses import asdict
import json
import sqlite3

import pytest

from invimport.execution.models import Certainty, OperationResult, Retry, State, Target, canonical
from invimport.execution.ownership import JournalError
from invimport.execution.run_control import complete
from invimport.execution.stock_evidence import FrozenEvidence, with_evidence
from invimport.execution.stock_workflow import execute_stock, prepare_full_stock, resume_stock
from invimport.execution.store import RunStore
from invimport.inventree.stockimport import ImportOptions
from tests.execution.test_foundation import operation, output, plan
from tests.execution.test_run_cli import invoke_process
from tests.execution.test_stock_workflow import document, scene as scene


@pytest.mark.parametrize('damage', ['state', 'certainty', 'output', 'attempt', 'request'])
def test_semantic_corruption_refuses_status_resume_and_store_before_remote_calls(scene, tmp_path, damage):
    api, categories, parameters = scene
    prepared = prepare_full_stock(document(tmp_path), api=api, categories=categories, parameters=parameters,
                                   target=Target(api.api_url), options=ImportOptions(archive=False, provenance=False))
    prepared = with_evidence(prepared, FrozenEvidence('a', 'label.txt', b'approved label'))
    api.fail('attachment/', 'lost')
    directory = tmp_path / 'run'
    snapshot = execute_stock(prepared, api=api, current_target=prepared.target, run_directory=directory)
    assert not complete(snapshot)
    path = directory / 'run.sqlite3'
    with sqlite3.connect(path) as connection:
        if damage == 'state':
            connection.execute("UPDATE operations SET state='succeeded' WHERE state='uncertain'")
        elif damage == 'certainty':
            key, serialized = connection.execute("SELECT id,result FROM operations WHERE state='uncertain'").fetchone()
            result = json.loads(serialized)
            result.update(state='succeeded', certainty='confirmed', retry='never')
            connection.execute("UPDATE operations SET state='succeeded',result=? WHERE id=?", (canonical(result), key))
        elif damage == 'output':
            key, serialized = next((key, value) for key, value in connection.execute('SELECT id,result FROM operations')
                                   if value and json.loads(value)['outputs'])
            result = json.loads(serialized)
            result['outputs'][0]['pk'] += 100000
            connection.execute('UPDATE operations SET result=? WHERE id=?', (canonical(result), key))
        elif damage == 'attempt':
            connection.execute("UPDATE attempts SET operation='unplanned' WHERE rowid=(SELECT max(rowid) FROM attempts)")
        else:
            connection.execute("UPDATE requests SET attempt='unowned' WHERE rowid=(SELECT max(rowid) FROM requests)")
    with api.connect() as connection:
        before = connection.execute('SELECT count(*) FROM calls').fetchone()[0]
    for arguments in (['status', snapshot['run_id'], '--json'],
                      ['resume', snapshot['run_id'], '--write', '--continuity-reason', 'same database', '--json']):
        rejected = invoke_process(arguments, api, tmp_path)
        assert rejected.returncode == 1 and json.loads(rejected.stdout)['error'] == 'JournalError'
    with pytest.raises(JournalError):
        with RunStore(path, plan=prepared, run_id=snapshot['run_id'], create=False):
            pytest.fail('corrupt store accepted')
    with pytest.raises(JournalError):
        resume_stock(prepared, snapshot['run_id'], path, api=api, current_target=prepared.target)
    with api.connect() as connection:
        assert connection.execute('SELECT count(*) FROM calls').fetchone()[0] == before


def test_running_checkpoint_and_running_repair_with_prior_result_remain_valid(tmp_path):
    spec = operation(provides=('part',), reconciliation='stock_v1')
    prepared = plan(spec)
    path = tmp_path / 'run.sqlite3'
    with RunStore(path, plan=prepared, run_id='run', create=True) as store:
        attempt = store.start(spec.id, mutation=True)
        checkpoint = OperationResult(State.SUCCEEDED, Certainty.CONFIRMED, outputs=(output(),))
        store.checkpoint(attempt, checkpoint)
        snapshot = store.snapshot()
        assert snapshot['operations'][0]['state'] == 'running'
        assert not complete(snapshot)
    with RunStore(path, plan=prepared, run_id='run', create=False) as store:
        assert store.results()[spec.id] == checkpoint
        store.recover_interrupted()
        assert store.results()[spec.id].certainty == Certainty.UNKNOWN
        store.start_stock_repair(spec.id)
    # A newly open repair retains the preceding uncertain result without claiming
    # that the old attempt is still running or erasing its checkpointed output.
    with RunStore(path, plan=prepared, run_id='run', create=False) as store:
        snapshot = store.snapshot()
        assert snapshot['operations'][0]['state'] == 'running'
        assert snapshot['operations'][0]['result']['state'] == 'uncertain'
        assert snapshot['operations'][0]['result']['outputs']


def test_blocked_operation_can_retain_prior_retry_wait_result(tmp_path):
    spec = operation(provides=('part',))
    prepared = plan(spec)
    path = tmp_path / 'run.sqlite3'
    with RunStore(path, plan=prepared, run_id='run', create=True) as store:
        attempt = store.start(spec.id, mutation=True)
        result = OperationResult(State.RETRY_WAIT, Certainty.UNKNOWN, Retry.RECONCILE, outputs=(output(),))
        store.finish(attempt, result)
        store.block(spec.id)
        assert store.snapshot()['operations'][0]['state'] == 'blocked'
    with RunStore(path, plan=prepared, run_id='run', create=False) as store:
        snapshot = store.snapshot()
        assert snapshot['operations'][0]['result']['state'] == 'retry_wait'
        assert not complete(snapshot)


def test_authorized_read_requeue_and_block_preserve_failed_result(tmp_path):
    spec = operation(mutation=False)
    prepared = plan(spec)
    path = tmp_path / 'run.sqlite3'
    with RunStore(path, plan=prepared, run_id='run', create=True) as store:
        attempt = store.start(spec.id, mutation=False)
        result = OperationResult(State.FAILED, retry=Retry.READ)
        store.finish(attempt, result)
        store.authorize_retry(spec.id)
        assert store.snapshot()['operations'][0]['state'] == 'ready'
        store.block(spec.id)
    with RunStore(path, plan=prepared, run_id='run', create=False) as store:
        assert store.results()[spec.id] == result
        assert store.states()[spec.id] == State.BLOCKED


def test_completion_never_trusts_promoted_row_over_unknown_result():
    result = OperationResult(State.UNCERTAIN, Certainty.UNKNOWN, Retry.RECONCILE)
    assert not complete({'operations': [{'state': 'succeeded', 'result': asdict(result)}]})
