#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3901}"
API_REPO="${API_REPO:-/home/ubuntu/arc-dex-api}"
HERMES_BIN="${HERMES_BIN:-$HOME/.hermes/hermes-agent/venv/bin/hermes}"
STAGING_DATA_DIR="${STAGING_DATA_DIR:-$API_REPO/data-staging}"

case "$BASE" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) echo "REFUSED: BASE must be localhost/127.0.0.1; production E2E is forbidden" >&2; exit 2 ;;
esac
[[ -x "$HERMES_BIN" ]] || { echo "Hermes binary not found: $HERMES_BIN" >&2; exit 2; }
[[ -f "$STAGING_DATA_DIR/vault-sessions.json" ]] || { echo "Staging vault session store not found" >&2; exit 2; }
[[ -f "$STAGING_DATA_DIR/session-keys.json" ]] || { echo "Staging session-key store not found" >&2; exit 2; }

export BASE API_REPO STAGING_DATA_DIR HERMES_BIN
python3 - <<'PY'
import json
import os
import pty
import select
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

base = os.environ['BASE'].rstrip('/')
data_dir = os.environ['STAGING_DATA_DIR']
hermes = os.environ['HERMES_BIN']


def load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def first_key(mapping, predicate=lambda value: True):
    for key, value in mapping.items():
        if predicate(value):
            return key, value
    raise RuntimeError('required staging fixture not found')


vault = load(os.path.join(data_dir, 'vault-sessions.json'))
sessions = vault.get('tokens', {})
owner_token, owner = first_key(sessions, lambda value: int(value.get('expires', 0)) > int(time.time() * 1000))
keys = load(os.path.join(data_dir, 'session-keys.json')).get('agentBindings', {})
# A passkey vault token identifies the MSCA, while the binding owner is the
# EOA. Pick a binding whose selected wallet matches the passkey identity.
agent_key, binding = first_key(keys, lambda value: str(value.get('walletAddress', '')).lower() == str(owner.get('userId', '')).lower())


def post_connection_token():
    body = urllib.request.Request(
        f'{base}/api/vault/agents/{urllib.parse.quote(agent_key, safe="")}/connection-token',
        data=json.dumps({'ttlDays': 90}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {owner_token}'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(body, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'connection-token endpoint returned HTTP {exc.code}') from exc
    token = result.get('token', '')
    if not token.startswith('arx_at_'):
        raise RuntimeError('connection-token endpoint returned no valid token')
    return token


def mcp_status(token):
    request = urllib.request.Request(
        f'{base}/mcp',
        data=json.dumps({
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {
                'protocolVersion': '2025-03-26', 'capabilities': {},
                'clientInfo': {'name': 'e2e-connection-token', 'version': '1'},
            },
        }).encode(),
        headers={
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


def run_hermes_add(token, home):
    env = dict(os.environ, HERMES_HOME=home)
    env.pop('MCP_ARCOX_API_KEY', None)
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(hermes, [hermes, 'mcp', 'add', 'arcox', '--url', f'{base}/mcp', '--auth', 'header'], env)
    output = bytearray()
    sent_auth = False
    sent_token = False
    sent_tools = False
    deadline = time.time() + 180
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 1)
        if fd in ready:
            try:
                chunk = os.read(fd, 8192)
            except OSError:
                chunk = b''
            if not chunk:
                try:
                    _, status = os.waitpid(pid, 0)
                    safe = output.decode('utf-8', 'replace').replace(token, '<redacted>')
                    print(safe[-2500:])
                    return os.waitstatus_to_exitcode(status)
                except ChildProcessError:
                    break
            output.extend(chunk)
            text = output.decode('utf-8', 'replace')
            if 'Does this server require authentication?' in text and not sent_auth:
                os.write(fd, b'y\n')
                sent_auth = True
            if 'API key / Bearer token' in text and not sent_token:
                os.write(fd, (token + '\n').encode())
                sent_token = True
            if 'Enable all' in text and not sent_tools:
                os.write(fd, b'y\n')
                sent_tools = True
        try:
            done, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            break
        if done:
            safe = output.decode('utf-8', 'replace').replace(token, '<redacted>')
            print(safe[-2500:])
            return os.waitstatus_to_exitcode(status)
    try:
        os.kill(pid, 15)
    except ProcessLookupError:
        pass
    print(output.decode('utf-8', 'replace').replace(token, '<redacted>')[-2500:])
    return 124


import urllib.parse

first_token = post_connection_token()
if not first_token.startswith('arx_at_'):
    raise RuntimeError('invalid first connection token')
print(f'PASS issue connection token for {agent_key.split("|")[0]}')

with tempfile.TemporaryDirectory(prefix='arcox-hermes-header-') as home:
    rc = run_hermes_add(first_token, home)
    if rc != 0:
        raise RuntimeError(f'Hermes mcp add failed with exit code {rc}')
    cfg = os.path.join(home, 'config.yaml')
    env_file = os.path.join(home, '.env')
    if not os.path.exists(cfg) or not os.path.exists(env_file):
        raise RuntimeError('Hermes did not persist profile configuration')
    print('PASS default Hermes mcp add --auth header persisted profile credentials')
    test = subprocess.run([hermes, 'mcp', 'test', 'arcox'], env=dict(os.environ, HERMES_HOME=home), capture_output=True, text=True, timeout=180)
    safe = (test.stdout + test.stderr).replace(first_token, '<redacted>')
    print(safe[-2500:])
    if test.returncode != 0 or 'Tools discovered:' not in safe:
        raise RuntimeError('default Hermes mcp test did not discover tools')
    print('PASS default Hermes tools/list')

second_token = post_connection_token()
if mcp_status(first_token) != 401:
    raise RuntimeError('old connection token was not revoked by rotation')
if mcp_status(second_token) != 200:
    raise RuntimeError('new connection token did not authenticate after rotation')
print('PASS rotation old token 401 / new token 200')
print('L2B CONNECTION TOKEN ALL PASS')
PY
