"""Zero-dependency HTTP/HTTPS forwarding proxy for ScribbleHub crawling.

Why this exists
---------------
ScribbleHub is behind a Cloudflare managed challenge. The crawler replays a
``cf_clearance`` cookie captured from your browser, but Cloudflare binds that
clearance to the *network fingerprint* of the machine that solved the challenge
(your Windows host), not just the public IP. When the crawler runs inside the
Linux Docker container, its TCP/TLS fingerprint differs from your Windows
browser, so Cloudflare re-challenges even with a valid cookie.

Running this tiny proxy on the **Windows host** and pointing the container at it
(``SCRIBBLEHUB_PROXY_URL=http://host.docker.internal:8899``) makes the actual TCP
connection to Cloudflare originate from the host — so the cf_clearance is
accepted and the crawler can read pages.

Usage
-----
    python scripts/scribblehub_host_proxy.py            # binds 0.0.0.0:8899
    python scripts/scribblehub_host_proxy.py --port 9000

Then set in the novel_crawler container environment:
    SCRIBBLEHUB_PROXY_URL=http://host.docker.internal:8899

Leave it running while you crawl ScribbleHub. It only tunnels traffic — it never
inspects or stores anything.
"""

from __future__ import annotations

import argparse
import logging
import select
import socket
import threading

logging.basicConfig(level=logging.INFO, format="%(asctime)s [host-proxy] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("scribblehub_host_proxy")

_BUFSIZE = 65536


def _pipe(a: socket.socket, b: socket.socket) -> None:
    """Bidirectionally forward bytes between two sockets until either closes."""
    sockets = [a, b]
    try:
        while True:
            readable, _, errored = select.select(sockets, [], sockets, 60)
            if errored or not readable:
                break
            for src in readable:
                dst = b if src is a else a
                data = src.recv(_BUFSIZE)
                if not data:
                    return
                dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass


def _read_headers(conn: socket.socket) -> bytes:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(_BUFSIZE)
        if not chunk:
            break
        data += chunk
        if len(data) > 65536:
            break
    return data


def _handle(client: socket.socket, addr) -> None:
    try:
        head = _read_headers(client)
        if not head:
            client.close()
            return
        request_line = head.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        parts = request_line.split(" ")
        if len(parts) < 2:
            client.close()
            return
        method, target = parts[0], parts[1]

        if method.upper() == "CONNECT":
            # HTTPS tunnel: target is host:port. Open it and splice raw bytes.
            host, _, port = target.partition(":")
            port_num = int(port or "443")
            upstream = socket.create_connection((host, port_num), timeout=30)
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            _pipe(client, upstream)
        else:
            # Plain HTTP: target is an absolute URL. Forward the raw request.
            from urllib.parse import urlsplit

            split = urlsplit(target)
            host = split.hostname or ""
            port_num = split.port or 80
            if not host:
                client.close()
                return
            upstream = socket.create_connection((host, port_num), timeout=30)
            upstream.sendall(head)
            _pipe(client, upstream)
    except Exception as exc:  # noqa: BLE001 - proxy must never crash on a bad request
        log.debug("connection error: %s", exc)
        try:
            client.close()
        except OSError:
            pass


def serve(host: str, port: int) -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(128)
    log.info("ScribbleHub host proxy listening on %s:%d", host, port)
    log.info("Set SCRIBBLEHUB_PROXY_URL=http://host.docker.internal:%d in the novel_crawler container.", port)
    try:
        while True:
            client, addr = server.accept()
            threading.Thread(target=_handle, args=(client, addr), daemon=True).start()
    except KeyboardInterrupt:
        log.info("Shutting down.")
    finally:
        server.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Host-side forwarding proxy for ScribbleHub crawling.")
    parser.add_argument("--host", default="0.0.0.0", help="Interface to bind (default 0.0.0.0 so the container can reach it).")
    parser.add_argument("--port", type=int, default=8899, help="Port to listen on (default 8899).")
    args = parser.parse_args()
    serve(args.host, args.port)


if __name__ == "__main__":
    main()
