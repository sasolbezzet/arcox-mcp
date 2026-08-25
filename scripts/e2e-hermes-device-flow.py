#!/usr/bin/env python3
"""E2E: patched Hermes device-flow client pairs with the local ARCOX backend.

Runs tools.mcp_oauth._maybe_run_device_flow against BASE (default :3901),
extracts the printed user_code, approves it like the /activate page would
(SIWE signature via node/viem), then verifies cached tokens exist.
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


def approve_in_background(user_code_holder):
    """Act like the /activate page once the user code is printed."""
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
  const d = await approveResp.json();
  console.log(JSON.stringify(d));
})();
"""
    env = dict(os.environ, BASE=BASE)
    deadline = time.time() + 30
    while time.time() < deadline:
        code = user_code_holder.get("code")
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


def main():
    with tempfile.TemporaryDirectory() as home:
        storage = HermesTokenStorage("arcox-e2e", hermes_home=home)
        holder = {}
        approver = threading.Thread(target=approve_in_background, args=(holder,))
        approver.start()

        buf = io.StringIO()
        result = {}

        def run_flow():
            with contextlib.redirect_stdout(buf):
                try:
                    result["ok"] = _maybe_run_device_flow(
                        "arcox-e2e",
                        BASE + "/mcp",
                        {"timeout": 120},
                        storage,
                    )
                except Exception as exc:  # noqa: BLE001
                    result["error"] = str(exc)

        thread = threading.Thread(target=run_flow)
        thread.start()
        # Stream the printed output into the holder until the code appears.
        while thread.is_alive():
            text = buf.getvalue()
            marker = "Device code: "
            idx = text.find(marker)
            if idx >= 0 and not holder.get("code"):
                holder["code"] = text[idx + len(marker):].strip().splitlines()[0].strip()
                print("[flow] user_code:", holder["code"])
            time.sleep(0.3)
        thread.join()
        approver.join()

        print(buf.getvalue())
        if "error" in result:
            print("FAIL flow error:", result["error"])
            return 1
        if not result.get("ok"):
            print("FAIL device flow did not complete")
            return 1
        if not storage.has_cached_tokens():
            print("FAIL tokens were not cached")
            return 1
        tokens = json.load(open(storage._tokens_path()))
        assert tokens.get("access_token", "").startswith("arx_at_"), tokens
        assert tokens.get("refresh_token", "").startswith("arx_rt_"), tokens
        print("PASS hermes device flow paired and cached real ARCOX tokens")
        return 0


if __name__ == "__main__":
    sys.exit(main())
