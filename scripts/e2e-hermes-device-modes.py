#!/usr/bin/env python3
"""E2E: Hermes `oauth.device_flow` mode selection.

- mode=local  -> _maybe_run_device_flow must return False immediately
                 (loopback same-device pairing is used instead).
- mode=device -> must pair via the RFC 8628 flow and cache tokens.
- mode=auto   -> same as device when the server advertises the endpoint.
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, "/home/ubuntu/.hermes/hermes-agent")
from tools.mcp_oauth import HermesTokenStorage, _maybe_run_device_flow  # noqa: E402

BASE = os.environ.get("BASE", "http://localhost:3901")
failures = 0


def check(name, cond, extra=""):
    global failures
    print(f"{'PASS' if cond else 'FAIL'} {name}{' :: ' + extra if extra else ''}")
    if not cond:
        failures += 1


def approve_in_background(holder):
    node_script = r"""
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
(async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const userCode = process.argv[1];
  const msgResp = await fetch(process.env.BASE + '/api/auth/device/message', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ address: account.address, user_code: userCode }),
  });
  if (!msgResp.ok) { console.error('message failed', msgResp.status); process.exit(1); }
  const msgData = await msgResp.json();
  const signature = await account.signMessage({ message: msgData.message });
  const approveResp = await fetch(process.env.BASE + '/api/auth/device/approve', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      address: account.address, message: msgData.message, signature,
      user_code: userCode, approve: true,
    }),
  });
  console.log(JSON.stringify(await approveResp.json()));
})();
"""
    env = dict(os.environ, BASE=BASE)
    deadline = time.time() + 30
    while time.time() < deadline:
        code = holder.get("code")
        if code:
            out = subprocess.run(
                ["node", "-e", node_script, code],
                capture_output=True, text=True, env=env,
                cwd="/home/ubuntu/arc-dex-api",
            )
            print("[approver]", out.stdout.strip() or out.stderr.strip())
            return
        time.sleep(0.5)
    print("[approver] timed out waiting for user_code")


def run_flow(storage, mode):
    holder = {}
    approver = threading.Thread(target=approve_in_background, args=(holder,))
    approver.start()
    buf = io.StringIO()
    result = {}

    def _inner():
        with contextlib.redirect_stdout(buf):
            try:
                result["ok"] = _maybe_run_device_flow(
                    "arcox-e2e", BASE + "/mcp", {"timeout": 120, "device_flow": mode}, storage,
                )
            except Exception as exc:  # noqa: BLE001
                result["error"] = str(exc)

    thread = threading.Thread(target=_inner)
    thread.start()
    while thread.is_alive():
        text = buf.getvalue()
        marker = "Device code: "
        idx = text.find(marker)
        if idx >= 0 and not holder.get("code"):
            holder["code"] = text[idx + len(marker):].strip().splitlines()[0].strip()
        time.sleep(0.3)
    thread.join()
    approver.join()
    return result, buf.getvalue()


def main():
    # Mode "local" must NOT attempt device flow (returns False, no side effects).
    with tempfile.TemporaryDirectory() as home:
        storage = HermesTokenStorage("arcox-local", hermes_home=home)
        result, out = run_flow(storage, "local")
        check("local mode skips device flow", result.get("ok") is False and "error" not in result)
        check("local mode prints nothing", "Device code:" not in out)
        check("local mode caches nothing", not storage.has_cached_tokens())

    # Mode "device" must pair and cache real tokens.
    with tempfile.TemporaryDirectory() as home:
        storage = HermesTokenStorage("arcox-device", hermes_home=home)
        result, out = run_flow(storage, "device")
        check("device mode pairs successfully", result.get("ok") is True, out[-200:].strip())
        check("device mode caches tokens", storage.has_cached_tokens())
        tokens = json.load(open(storage._tokens_path()))
        check("cached access token", str(tokens.get("access_token", "")).startswith("arx_at_"))
        check("cached refresh token", str(tokens.get("refresh_token", "")).startswith("arx_rt_"))

    # Mode "auto" behaves like device when the server advertises it.
    with tempfile.TemporaryDirectory() as home:
        storage = HermesTokenStorage("arcox-auto", hermes_home=home)
        result, out = run_flow(storage, "auto")
        check("auto mode pairs successfully", result.get("ok") is True, out[-200:].strip())

    print("\nALL PASS" if failures == 0 else f"\n{failures} FAILURES")
    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
