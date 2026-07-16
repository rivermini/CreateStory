"""Regression tests for _RetryTransport.

On 2026-07-12 the retry path crashed with AttributeError (httpx.Request has no
.copy()) and leaked the discarded response's pool connection, wedging the
gateway once upstreams started returning 5xx under CPU saturation.
"""

import asyncio

import httpx

from api.middleware import _RetryTransport


class _FakeInner(httpx.AsyncBaseTransport):
    def __init__(self, responses: list[httpx.Response]) -> None:
        self._responses = responses
        self.requests_sent = 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests_sent += 1
        return self._responses.pop(0)


def _run(coro):
    return asyncio.run(coro)


def test_retry_on_503_returns_next_response_and_closes_discarded_one() -> None:
    async def scenario():
        transport = _RetryTransport(retries=2, backoff_factor=0)
        first = httpx.Response(503, content=b"upstream busy")
        second = httpx.Response(200, content=b"ok")
        inner = _FakeInner([first, second])
        transport._inner = inner
        response = await transport.handle_async_request(httpx.Request("GET", "http://upstream.local/x"))
        return inner, first, response

    inner, first, response = _run(scenario())
    assert response.status_code == 200
    assert inner.requests_sent == 2
    assert first.is_closed  # discarded response must release its pool connection


def test_retry_on_connect_error_resends_request() -> None:
    class _FlakyInner(httpx.AsyncBaseTransport):
        def __init__(self) -> None:
            self.requests_sent = 0

        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            self.requests_sent += 1
            if self.requests_sent == 1:
                raise httpx.ConnectError("boom", request=request)
            return httpx.Response(200, content=b"ok")

    async def scenario():
        transport = _RetryTransport(retries=2, backoff_factor=0)
        inner = _FlakyInner()
        transport._inner = inner
        response = await transport.handle_async_request(httpx.Request("GET", "http://upstream.local/x"))
        return inner, response

    inner, response = _run(scenario())
    assert response.status_code == 200
    assert inner.requests_sent == 2


def test_non_idempotent_methods_are_never_retried() -> None:
    async def scenario():
        transport = _RetryTransport(retries=2, backoff_factor=0)
        inner = _FakeInner([httpx.Response(503, content=b"upstream busy")])
        transport._inner = inner
        return inner, await transport.handle_async_request(httpx.Request("POST", "http://upstream.local/x"))

    inner, response = _run(scenario())
    assert response.status_code == 503
    assert inner.requests_sent == 1
