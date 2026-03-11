#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def run(cmd: List[str], cwd: Optional[Path] = None) -> str:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(cmd)}\\n{result.stderr.strip()}"
        )
    return result.stdout.strip()


def gh_api_json(endpoint: str) -> Any:
    out = run(["gh", "api", endpoint])
    return json.loads(out)


def ensure_tag(repo_path: Path, tag: str) -> bool:
    result = subprocess.run(
        ["git", "rev-parse", "--verify", f"refs/tags/{tag}"],
        cwd=str(repo_path),
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def get_git_log(repo_path: Path, prev_tag: str, curr_tag: str, limit: int) -> List[Dict[str, str]]:
    out = run(
        [
            "git",
            "log",
            "--no-merges",
            f"--max-count={limit}",
            "--pretty=format:%H%x09%s",
            f"{prev_tag}..{curr_tag}",
        ],
        cwd=repo_path,
    )
    rows: List[Dict[str, str]] = []
    if not out:
        return rows
    for line in out.splitlines():
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        rows.append({"sha": parts[0], "subject": parts[1]})
    return rows


def get_changed_files(repo_path: Path, prev_tag: str, curr_tag: str, limit: int) -> List[Dict[str, str]]:
    out = run(["git", "diff", "--name-status", f"{prev_tag}..{curr_tag}"], cwd=repo_path)
    rows: List[Dict[str, str]] = []
    if not out:
        return rows
    for line in out.splitlines()[:limit]:
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        rows.append({"status": parts[0], "path": parts[-1]})
    return rows


def collect_top_paths(changed_files: List[Dict[str, str]], limit: int = 12) -> List[Dict[str, int]]:
    counts: Dict[str, int] = {}
    for item in changed_files:
        path = item["path"]
        top = path.split("/", 1)[0] if "/" in path else "(root)"
        counts[top] = counts.get(top, 0) + 1
    return [
        {"segment": segment, "changed_files": count}
        for segment, count in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    ]


def maybe_fetch_tags(repo_path: Path, should_fetch: bool) -> None:
    if should_fetch:
        run(["git", "fetch", "--tags", "--force"], cwd=repo_path)


def build_payload(owner_repo: str, repo_path: Optional[Path], fetch_tags: bool, commit_limit: int, file_limit: int) -> Dict[str, Any]:
    latest = gh_api_json(f"repos/{owner_repo}/releases/latest")
    releases = gh_api_json(f"repos/{owner_repo}/releases?per_page=10")

    latest_tag = latest.get("tag_name")
    previous = next((r for r in releases if r.get("tag_name") and r.get("tag_name") != latest_tag), None)
    previous_tag = previous.get("tag_name") if previous else None

    payload: Dict[str, Any] = {
        "owner_repo": owner_repo,
        "latest_release": {
            "tag": latest_tag,
            "name": latest.get("name"),
            "published_at": latest.get("published_at"),
            "url": latest.get("html_url"),
            "target_commitish": latest.get("target_commitish"),
            "body": latest.get("body"),
        },
        "previous_release": {
            "tag": previous_tag,
            "name": previous.get("name") if previous else None,
            "published_at": previous.get("published_at") if previous else None,
            "url": previous.get("html_url") if previous else None,
        },
        "git_analysis": None,
    }

    if not repo_path:
        return payload

    if not latest_tag or not previous_tag:
        payload["git_analysis"] = {"note": "Could not compare tags because latest or previous release tag is missing."}
        return payload

    maybe_fetch_tags(repo_path, fetch_tags)

    if not ensure_tag(repo_path, latest_tag) or not ensure_tag(repo_path, previous_tag):
        payload["git_analysis"] = {
            "note": "Tags were not found in local repository. Run with --fetch-tags and ensure repository path is correct.",
            "latest_tag_found": ensure_tag(repo_path, latest_tag),
            "previous_tag_found": ensure_tag(repo_path, previous_tag),
        }
        return payload

    commit_rows = get_git_log(repo_path, previous_tag, latest_tag, commit_limit)
    file_rows = get_changed_files(repo_path, previous_tag, latest_tag, file_limit)
    shortstat = run(["git", "diff", "--shortstat", f"{previous_tag}..{latest_tag}"], cwd=repo_path)

    payload["git_analysis"] = {
        "range": f"{previous_tag}..{latest_tag}",
        "shortstat": shortstat,
        "commit_count": len(commit_rows),
        "file_count": len(file_rows),
        "top_paths": collect_top_paths(file_rows),
        "commits": commit_rows,
        "changed_files": file_rows,
    }

    return payload


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Collect GitHub release metadata and optional git diff context for summary writing."
    )
    parser.add_argument("owner_repo", help="GitHub repository in owner/name format.")
    parser.add_argument(
        "--repo-path",
        help="Path to local git checkout for tag-to-tag diff analysis.",
    )
    parser.add_argument(
        "--fetch-tags",
        action="store_true",
        help="Fetch tags before running git comparison.",
    )
    parser.add_argument(
        "--commit-limit",
        type=int,
        default=150,
        help="Maximum number of commits to include in payload.",
    )
    parser.add_argument(
        "--file-limit",
        type=int,
        default=500,
        help="Maximum number of changed files to include in payload.",
    )
    parser.add_argument(
        "--output",
        help="Optional output file path. Prints to stdout when omitted.",
    )

    args = parser.parse_args()

    repo_path = Path(args.repo_path).resolve() if args.repo_path else None
    if repo_path and not repo_path.exists():
        print(f"Repository path does not exist: {repo_path}", file=sys.stderr)
        return 2

    try:
        payload = build_payload(
            owner_repo=args.owner_repo,
            repo_path=repo_path,
            fetch_tags=args.fetch_tags,
            commit_limit=args.commit_limit,
            file_limit=args.file_limit,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    text = json.dumps(payload, ensure_ascii=False, indent=2)
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
