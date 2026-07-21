"""Sandbox entry point: run a forged tool's run(args) in an isolated process.

Invoked as:  python -I _tool_runner.py <tool_path> <json_args>
-I gives isolated mode (no site-packages injection from cwd, no env hooks).
The parent enforces the timeout and captures stdout as the tool's result.
"""

import json
import runpy
import sys

if __name__ == "__main__":
    module = runpy.run_path(sys.argv[1])
    if "run" not in module or not callable(module["run"]):
        print("Tool file has no callable run(args) function.", file=sys.stderr)
        raise SystemExit(2)
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    result = module["run"](args)
    print(result if isinstance(result, str) else json.dumps(result))
