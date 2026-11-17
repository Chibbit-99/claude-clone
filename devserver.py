#!/usr/bin/env python3
"""Tiny static server for local preview.

Plain `python -m http.server` sends no Cache-Control, so browsers apply
heuristic caching and can keep running an old app.js after an edit. This
server always revalidates so a reload picks up the current files.
"""
import http.server
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        # drop conditional headers so the browser never gets a 304
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", port), NoCacheHandler) as httpd:
        print("serving on 0.0.0.0:%d (no-cache)" % port, flush=True)
        httpd.serve_forever()
