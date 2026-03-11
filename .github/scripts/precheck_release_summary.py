#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

import subprocess


def run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(cmd)}\\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def gh_api_json(endpoint: str) -> Any:
    out = run(["gh", "api", endpoint])
    if not out:
        return {}
    return json.loads(out)


def sanitize_repo(owner_repo: str) -> str:
    return owner_repo.replace("/", "__")


def read_last_tag(state_file: Path) -> str:
    if not state_file.exists():
        return ""
    return state_file.read_text(encoding="utf-8").strip()


def build_result(owner_repo: str, state_file: Path) -> Dict[str, Any]:
    latest = gh_api_json(f"repos/{owner_repo}/releases/latest")
    latest_tag = str(latest.get("tag_name") or "").strip()
    last_processed_tag = read_last_tag(state_file)

    if not latest_tag:
        return {
            "owner_repo": owner_repo,
            "state_file": str(state_file),
            "latest_tag": "",
            "last_processed_tag": last_processed_tag,
            "should_generate": False,
            "reason": "No latest release tag found.",
        }

    should_generate = latest_tag != last_processed_tag
    reason = (
        "New release detected; summary generation required."
        if should_generate
        else "Latest release already processed; skip summary generation."
    )

    return {
        "owner_repo": owner_repo,
        "state_file": str(state_file),
        "latest_tag": latest_tag,
        "last_processed_tag": last_processed_tag,
        "should_generate": should_generate,
        "reason": reason,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Lightweight precheck to decide whether bilingual release summary generation is needed."
    )
    parser.add_argument("owner_repo", help="GitHub repository in owner/name format.")
    parser.add_argument(
        "--state-file",
        help="Path storing the last successfully processed release tag. Defaults to /tmp/release-summary-state-<owner__repo>.txt",
    )
    parser.add_argument("--output", help="Optional JSON output file path.")

    args = parser.parse_args()
    default_state = Path(f"/tmp/release-summary-state-{sanitize_repo(args.owner_repo)}.txt")
    state_file = Path(args.state_file).resolve() if args.state_file else default_state

    try:
        result = build_result(args.owner_repo, state_file)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        out_path = Path(args.output).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text + "\n", encoding="utf-8")
        print(str(out_path))
    else:
        print(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
