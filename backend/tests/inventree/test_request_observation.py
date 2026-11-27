"""Exercise pinned SDK entrypoints against a fake HTTP transport."""
import io
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import requests

from invimport.commands.import_progress import ImportProgress
from invimport.execution.observation import (
    Observation, correlated, observing, operation,
)
from invimport.execution.transport import external_get
from invimport.inventree.observed_api import client
from invimport.inventree.api import Part


class Response:
    def __init__(self, payload, status=200):
        self.text = json.dumps(payload)
        self.status_code = status
        self.headers = {"content-type": "application/json"}
        self.history = []
        self.content = b"image"

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def iter_content(self, **kwargs):
        yield self.content


class Transport:
    def __init__(self, observation, stream=None):
        self.observation = observation
        self.stream = stream
        self.calls = []

    def __getattr__(self, method):
        def send(url, **kwargs):
            events = self.observation.snapshot()
            assert events[-1].kind == "request_started"
            if self.stream is not None:
                assert f"request {events[-1].request[:8]} start" in self.stream.getvalue()
                assert self.stream.flushes > len(self.calls)
            self.calls.append((method, url))
            if url.endswith('/api/'):
                return Response({"server": "InvenTree", "apiVersion": 530})
            if 'user/me' in url:
                return Response({"username": "username-canary"})
            if 'user/token' in url:
                return Response({"token": "token-canary"})
            if method == 'post':
                return Response({"pk": 7}, 201)
            if method == 'delete':
                return Response(None, 204)
            return Response({"pk": 7, "name": "part"})
        return send


class FlushedStream(io.StringIO):
    flushes = 0

    def flush(self):
        self.flushes += 1
        super().flush()


@pytest.mark.parametrize('credentials', [
    {"token": "token-canary"},
    {"username": "username-canary", "password": "password-canary"},
])
def test_actual_sdk_startup_crud_reload_options_download_are_visible_before_http(
        credentials, tmp_path, caplog):
    stream = FlushedStream()
    observation = Observation(ImportProgress(stream))
    transport = Transport(observation, stream)
    original_get = requests.get
    with caplog.at_level(logging.DEBUG), observing(observation):
        api = client('https://inventory.invalid', observation=observation,
                     transport=transport, **credentials)
        api.get('part/')
        api.request('part/', method='options')
        part = Part.create(api, {'name': 'payload-canary'})
        part.reload()
        api.patch('part/7', {'name': 'payload-canary'})
        api.put('part/7', {'name': 'payload-canary'})
        api.delete('part/7')
        api.request('part/attachment', method='post', files={'attachment': io.BytesIO(b'x')})
        api.downloadFile('/media/image?signature=signed-canary', str(tmp_path / 'image'))
        external_get('https://cdn.invalid/file?token=query-canary', transport=transport)
    assert requests.get is original_get
    starts = [event for event in observation.snapshot() if event.kind == 'request_started']
    terminals = [event for event in observation.snapshot() if event.kind == 'request_finished']
    assert len(starts) == len(transport.calls) == len(terminals)
    assert {event.request for event in starts} == {event.request for event in terminals}
    assert any(event.status == 201 for event in terminals)
    assert any(event.label == 'GET external download' for event in starts)
    output = caplog.text + stream.getvalue() + json.dumps(observation.export())
    for secret in ('token-canary', 'username-canary', 'password-canary',
                   'payload-canary', 'signed-canary', 'query-canary'):
        assert secret not in output


def test_overlapping_workers_keep_immutable_source_and_unique_sequences():
    observation = Observation()
    barrier = Barrier(2)

    class Overlap:
        def post(self, url, **kwargs):
            barrier.wait(timeout=2)
            return Response({'pk': 1}, 201)

    with observing(observation), ThreadPoolExecutor(max_workers=2) as pool:
        futures = []
        for source in ('source-one', 'source-two'):
            with operation('parameters', source=source, group='lines'):
                futures.append(pool.submit(correlated(lambda: external_get(
                    'ignored', transport=type('Download', (), {
                        'get': lambda self, url, **kw: Overlap().post(url)})()))))
        for future in futures:
            future.result()
    events = observation.snapshot()
    assert [event.sequence for event in events] == list(range(1, len(events) + 1))
    starts = [event for event in events if event.kind == 'request_started']
    assert {event.context.source for event in starts} == {'source-one', 'source-two'}
    assert len({event.context.attempt for event in starts}) == 2


def test_renderer_failure_does_not_replay_confirmed_create():
    def broken(event):
        raise OSError('unsafe-canary')
    observation = Observation(broken)
    transport = Transport(observation)
    with observing(observation):
        api = client('https://inventory.invalid', observation=observation,
                     transport=transport, token='token')
        assert Part.create(api, {'name': 'part'}).pk == 7
    assert sum(method == 'post' for method, _ in transport.calls) == 1
    assert observation.delivery_failures > 0
    assert any(event.status == 201 for event in observation.snapshot())


def test_transport_exception_safe_events_and_cancellation_prevents_dispatch():
    observation = Observation()
    class Broken:
        def get(self, *args, **kwargs):
            raise requests.Timeout('exception-secret')
    with observing(observation), pytest.raises(requests.Timeout):
        external_get('https://invalid/?secret=secret', transport=Broken())
    assert observation.snapshot()[-1].outcome == 'exchange_unknown'
    assert 'exception-secret' not in str(observation.export())
    observation.cancelled.set()
    with observing(observation), pytest.raises(InterruptedError):
        external_get('https://invalid', transport=Broken())
    assert observation.snapshot()[-1].outcome == 'not_dispatched'


def test_existing_parameter_and_prefetch_pools_overlap_with_sibling_failure(
        monkeypatch, tmp_path):
    from invimport.inventree import datasheets, parts

    observation = Observation()
    barrier = Barrier(4)

    class Parameters:
        def post(self, url, **kwargs):
            barrier.wait(timeout=3)
            if kwargs['json']['name'] == 'fail':
                raise requests.Timeout('unsafe-exception-body')
            return Response({'pk': 1}, 201)

    def pdf(url, **kwargs):
        barrier.wait(timeout=3)
        response = Response({})
        response.content = b'%PDF-1.4\n%%EOF'
        return response

    monkeypatch.setattr(datasheets.requests, 'get', pdf)
    with observing(observation), operation('line', source='line-source'):
        api = client('https://inventory.invalid', observation=observation,
                     transport=Parameters(), connect=False, token='token')
        api.connected = True
        api.api_version = 530
        with ThreadPoolExecutor(max_workers=2) as outer:
            parameters = outer.submit(correlated(parts._write_parameters), [
                lambda: api.post('parameter', {'name': 'fail'}),
                lambda: api.post('parameter', {'name': 'ok'}),
            ])
            downloads = outer.submit(correlated(datasheets.prefetch), [
                'https://cdn.invalid/one.pdf', 'https://cdn.invalid/two.pdf'],
                cache_dir=tmp_path)
            with pytest.raises(requests.Timeout):
                parameters.result()
            downloads.result()
    events = observation.snapshot()
    starts = [event for event in events if event.kind == 'request_started']
    assert len(starts) == 4
    assert {event.context.source for event in starts} == {'line-source'}
    assert len({event.context.attempt for event in starts}) == 4
    assert len({event.sequence for event in events}) == len(events)
    terminals = [event for event in events if event.kind == 'request_finished']
    assert {event.request for event in starts} == {event.request for event in terminals}
    assert sum(event.outcome == 'exchange_unknown' for event in terminals) == 1
    assert len(list(tmp_path.rglob('*.pdf'))) == 2


def test_pagination_and_failed_model_keep_http_outcomes_separate():
    from invimport.inventree.collections import list_rows
    from inventree.base import InventreeObject

    observation = Observation()

    class Pages(Transport):
        def get(self, url, **kwargs):
            assert self.observation.snapshot()[-1].kind == 'request_started'
            if kwargs.get('params', {}).get('offset') == '1':
                return Response({'count': 2, 'results': [{'pk': 2}], 'next': None})
            return Response({'count': 2, 'results': [{'pk': 1}],
                             'next': '?offset=1'})

    class FailedModel(InventreeObject):
        URL = 'part'

        def __init__(self, *args, **kwargs):
            raise ValueError('model-body-secret')

    with observing(observation), operation('source', source='line'):
        api = client('https://inventory.invalid', observation=observation,
                     transport=Pages(observation), connect=False, token='token')
        api.connected = True
        api.api_version = 530
        assert len(list_rows(api, 'part')) == 2
        with pytest.raises(ValueError):
            FailedModel.create(api, {'name': 'part'})
    events = observation.snapshot()
    assert sum(event.kind == 'request_started' for event in events) == 3
    assert any(event.status == 201 for event in events)
    assert any(event.outcome == 'construction_failed_after_response' for event in events)
    assert 'model-body-secret' not in str(observation.export())


def test_independent_clients_and_quiet_library_observation(capsys):
    first, second = Observation(), Observation()
    one = client('https://inventory.invalid', observation=first,
                 transport=Transport(first), token='one')
    two = client('https://inventory.invalid', observation=second,
                 transport=Transport(second), token='two')
    before = len(second.snapshot())
    one.get('part')
    assert len(second.snapshot()) == before
    two.get('stock')
    assert capsys.readouterr() == ('', '')


def test_legacy_and_http_debug_logs_cannot_leak_during_observed_scope(caplog):
    from invimport.execution.transport import protect_import_logs, safe_failure

    protect_import_logs()
    with caplog.at_level(logging.DEBUG), observing(Observation()):
        for name in ('inventree', 'invimport.inventree.parts', 'urllib3.connectionpool'):
            logging.getLogger(name).error('secret-log-canary', exc_info=True)
        assert 'error-body-canary' not in safe_failure(
            requests.HTTPError({'body': 'error-body-canary'}))
    assert 'secret-log-canary' not in caplog.text
    # The filter is scoped; unrelated library diagnostics retain their contract.
    logging.getLogger('invimport.inventree.parts').warning('outside-observation')
    assert 'outside-observation' in caplog.text


def test_cancel_from_start_observer_prevents_send_with_correlated_terminal():
    def cancel(event):
        if event.kind == 'request_started':
            observation.cancelled.set()
    observation = Observation(cancel)
    class NeverSend:
        def get(self, *args, **kwargs):
            pytest.fail('cancelled request reached HTTP')
    with observing(observation), pytest.raises(InterruptedError):
        external_get('https://invalid', transport=NeverSend())
    start, terminal = observation.snapshot()
    assert start.request == terminal.request
    assert terminal.kind == 'request_finished'
    assert terminal.outcome == 'not_dispatched'


def test_actual_logo_upload_error_cannot_leak_through_result_or_cli_report(
        monkeypatch, tmp_path, capsys, caplog):
    from invimport.commands.import_stock import report_logos
    from invimport.inventree import companies
    from invimport.inventree.api import Company

    observation = Observation()

    class Denied:
        def patch(self, url, **kwargs):
            assert 'files' in kwargs and 'image' in kwargs['files']
            return Response({'detail': 'BODY_CANARY'}, 403)

    path = tmp_path / 'logo.png'
    path.write_bytes(b'image')
    with observing(observation):
        api = client('https://inventory.invalid', observation=observation,
                     transport=Denied(), connect=False, token='TOKEN_CANARY')
        api.connected = True
        api.api_version = 530
        company = Company(api, data={'pk': 1, 'name': 'Maker', 'image': ''})
        monkeypatch.setattr(companies, 'list_companies', lambda api: [company])
        actions = companies.set_logos(
            api, {'Maker': {'image': str(path)}}, write=True)
        report_logos(actions)
    output = capsys.readouterr()
    combined = output.out + output.err + caplog.text + str(actions) + str(observation.export())
    assert actions[0].action == companies.FAILED
    assert 'HTTPError' in actions[0].reason
    assert 'BODY_CANARY' not in combined
    assert 'TOKEN_CANARY' not in combined
    assert 'AUTHORIZATION' not in combined
    assert any(event.status == 403 for event in observation.snapshot())


def test_exception_result_reason_preserves_unobserved_library_diagnostics():
    from invimport.execution.transport import exception_reason

    error = requests.HTTPError({'body': 'library-body'})
    assert 'library-body' in exception_reason(error)
    with observing(Observation()):
        assert 'library-body' not in exception_reason(error)


def test_decode_and_model_events_identify_origin_through_constructor_reload():
    from inventree.base import InventreeObject

    observation = Observation()
    transport = Transport(observation)

    class ReloadedModel(InventreeObject):
        URL = 'part'

        def __init__(self, api, **kwargs):
            super().__init__(api, **kwargs)
            self.reload()

    with observing(observation), operation('one attempt'):
        api = client('https://inventory.invalid', observation=observation,
                     transport=transport, connect=False, token='token')
        api.connected = True
        api.api_version = 530
        ReloadedModel.create(api, {'name': 'part'})
        api.get('stock/7')
    events = observation.snapshot()
    starts = {event.request: event for event in events if event.kind == 'request_started'}
    decodes = [event for event in events if event.kind == 'decode_finished']
    assert len(decodes) == 3
    assert all(event.request in starts for event in decodes)
    assert len({event.request for event in decodes}) == 3
    model = next(event for event in events if event.kind == 'model_finished')
    assert starts[model.request].label.startswith('POST ')
    reload_decode = next(event for event in decodes
                         if starts[event.request].label.startswith('GET inventory /api/part/'))
    assert reload_decode.request != model.request
