#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy the NetOps PWA Worker (module syntax + KV binding + workers.dev)."""
import json
import os
import urllib.error
import urllib.request
import uuid

ACCOUNT = "72fee1ecf2db28a31823b6294f12a0aa"
NS = "b6fb5e9c3f3c48e8867baa0aeb49c010"
SCRIPT = "netops-pwa-api"
TOKEN = os.environ["CF_API_TOKEN"]
WORKER = r"D:\NetOpsHub\pwa\worker.js"


def multipart(parts):
    boundary = "----netops" + uuid.uuid4().hex
    out = b""
    for name, filename, content_type, data in parts:
        out += f"--{boundary}\r\n".encode()
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disp += f'; filename="{filename}"'
        out += (disp + "\r\n").encode()
        out += f"Content-Type: {content_type}\r\n\r\n".encode()
        out += data if isinstance(data, bytes) else data.encode("utf-8")
        out += b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return out, f"multipart/form-data; boundary={boundary}"


code = open(WORKER, "rb").read()
metadata = json.dumps({
    "main_module": "worker.js",
    "bindings": [{"type": "kv_namespace", "name": "NETOPS_KV", "namespace_id": NS}],
    "compatibility_date": "2026-01-01",
})
body, content_type = multipart([
    ("metadata", None, "application/json", metadata),
    ("worker.js", "worker.js", "application/javascript+module", code),
])
url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}"
request = urllib.request.Request(url, data=body, method="PUT", headers={
    "Authorization": f"Bearer {TOKEN}", "Content-Type": content_type,
})
try:
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    print("upload:", result.get("success"), result.get("errors"))
except urllib.error.HTTPError as error:
    print("upload failed:", error.code, error.read().decode()[:600])
    raise SystemExit(1)

sub_url = url + "/subdomain"
request = urllib.request.Request(
    sub_url,
    data=json.dumps({"enabled": True, "previews_enabled": True}).encode(),
    method="POST",
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "Cloudflare-Workers-Script-Api-Date": "2025-08-01",
    },
)
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    print("workers.dev:", result.get("success"), result.get("result"))
except urllib.error.HTTPError as error:
    print("subdomain failed:", error.code, error.read().decode()[:400])
