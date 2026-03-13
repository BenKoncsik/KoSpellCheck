#!/usr/bin/env python3
"""Generate EN+HU release summary from collected context.

Behavior:
- Try OpenAI generation when OPENAI_API_KEY is available.
- Fall back to deterministic local summary when API/model is unavailable.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
VS_CODE_MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=BenKoncsik.kospellcheck"
VS2022_MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=BenKoncsik.BenKoncsik-KoSpellCheck-VS2022"


def load_context(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Context file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Context payload must be a JSON object")
    return data


def short_list(values: List[str], limit: int = 5) -> List[str]:
    return [v for v in values if v][:limit]


def _safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _safe_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def has_hungarian_diacritics(text: str) -> bool:
    return any(ch in text for ch in "áéíóöőúüűÁÉÍÓÖŐÚÜŰ")


def assert_hungarian_diacritics(summary_text: str) -> None:
    if "## Magyar" not in summary_text:
        raise RuntimeError("Generated output is missing '## Magyar' section")
    hu_part = summary_text.split("## Magyar", 1)[1]
    if not has_hungarian_diacritics(hu_part):
        raise RuntimeError("Hungarian section appears to be missing diacritics")


def build_fallback_summary(context: Dict[str, Any]) -> str:
    latest = _safe_dict(context.get("latest_release"))
    previous = _safe_dict(context.get("previous_release"))
    git_analysis = _safe_dict(context.get("git_analysis"))

    latest_tag = str(latest.get("tag") or "(unknown)")
    prev_tag = str(previous.get("tag") or "(none)")
    compare_range = str(git_analysis.get("range") or f"{prev_tag}..{latest_tag}")
    shortstat = str(git_analysis.get("shortstat") or "No diff stats available")

    commits = _safe_list(git_analysis.get("commits"))
    changed_files = _safe_list(git_analysis.get("changed_files"))
    top_paths = _safe_list(git_analysis.get("top_paths"))

    commit_subjects = short_list([
        str(item.get("subject") or "")
        for item in commits
        if isinstance(item, dict)
    ])

    path_bullets = short_list([
        f"{item.get('segment')} ({item.get('changed_files')} files)"
        for item in top_paths
        if isinstance(item, dict)
    ])

    if not commit_subjects:
        commit_subjects = ["No commit subjects available in collected context."]
    if not path_bullets:
        path_bullets = ["No path distribution available in collected context."]

    changed_count = len(changed_files)
    commit_count = len(commits)

    en_lines = [
        "## English",
        "",
        "### What changed",
        f"- Compared range: `{compare_range}`",
        f"- Diff summary: {shortstat}",
        f"- Commit count (captured): {commit_count}",
        f"- Changed files (captured): {changed_count}",
        "",
        "### New features",
    ]
    en_lines.extend([f"- {line}" for line in commit_subjects[:3]])
    en_lines.extend([
        "",
        "### Fixes and quality improvements",
    ])
    en_lines.extend([f"- {line}" for line in commit_subjects[3:5] or ["No explicit fix commits detected in top entries."]])
    en_lines.extend([
        "",
        "### Potential impact and migration notes",
        "- Review changed areas before deployment:",
    ])
    en_lines.extend([f"- {line}" for line in path_bullets])
    en_lines.extend([
        "- If this is your first summarized release, treat this as a baseline summary.",
        "",
        "### Marketplace links",
        f"- VS Code: {VS_CODE_MARKETPLACE_URL}",
        f"- Visual Studio 2022: {VS2022_MARKETPLACE_URL}",
        "",
        "## Magyar",
        "",
        "### Mi változott",
        f"- Összehasonlított tartomány: `{compare_range}`",
        f"- Diff összegzés: {shortstat}",
        f"- Commit darabszám (rögzített): {commit_count}",
        f"- Módosított fájlok (rögzített): {changed_count}",
        "",
        "### Új funkciók",
    ])
    en_lines.extend([f"- {line}" for line in commit_subjects[:3]])
    en_lines.extend([
        "",
        "### Hibajavítások és minőségi fejlesztések",
    ])
    en_lines.extend([f"- {line}" for line in commit_subjects[3:5] or ["Nincs külön javítás-jellegű commit a top elemekben."]])
    en_lines.extend([
        "",
        "### Várható hatás és migrációs megjegyzések",
        "- Érintett területek ellenőrzése telepítés előtt:",
    ])
    en_lines.extend([f"- {line}" for line in path_bullets])
    en_lines.extend([
        "- Ha ez az első összegzett release, kezeld bázis összegzésként.",
        "",
        "### Marketplace linkek",
        f"- VS Code: {VS_CODE_MARKETPLACE_URL}",
        f"- Visual Studio 2022: {VS2022_MARKETPLACE_URL}",
        "",
    ])

    return "\n".join(en_lines)


def _extract_output_text(payload: Dict[str, Any]) -> str:
    text = payload.get("output_text")
    if isinstance(text, str) and text.strip():
        return text.strip()

    output = payload.get("output")
    if isinstance(output, list):
        chunks: List[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in ("output_text", "text"):
                    maybe = part.get("text")
                    if isinstance(maybe, str) and maybe.strip():
                        chunks.append(maybe.strip())
        if chunks:
            return "\n\n".join(chunks)

    return ""


def try_openai_summary(context: Dict[str, Any], model: str, timeout: int) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    system_prompt = (
        "You generate concise bilingual (English then Hungarian) software release summaries. "
        "Ground all claims in provided JSON context. Use headings exactly: "
        "English/What changed/New features/Fixes and quality improvements/Potential impact and migration notes "
        "and Hungarian equivalents. Also include a 'Marketplace links' section in English and a "
        "'Marketplace linkek' section in Hungarian with these exact links: "
        f"VS Code: {VS_CODE_MARKETPLACE_URL} and Visual Studio 2022: {VS2022_MARKETPLACE_URL}. "
        "Hungarian text must use proper Hungarian diacritics "
        "(á, é, í, ó, ö, ő, ú, ü, ű). Never transliterate Hungarian to ASCII."
    )

    user_prompt = (
        "Generate EN+HU summary from this context JSON. Keep technical names unchanged. "
        "If data is missing, state that explicitly. "
        "Hungarian section must contain correct Hungarian diacritics. "
        "Include a marketplace-links section in both languages and keep these URLs exactly as-is: "
        f"{VS_CODE_MARKETPLACE_URL} ; {VS2022_MARKETPLACE_URL}\n\n"
        + json.dumps(context, ensure_ascii=False)
    )

    body = {
        "model": model,
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    req = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    text = _extract_output_text(payload)
    if not text:
        raise RuntimeError("OpenAI response did not contain output text")
    assert_hungarian_diacritics(text)
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate bilingual EN+HU release summary from collected context.")
    parser.add_argument(
        "--context-file",
        "--input",
        dest="context_file",
        default="/tmp/release-context.json",
        help="Path to collected context JSON",
    )
    parser.add_argument("--output", default="/tmp/release-summary.md", help="Output markdown path")
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"), help="OpenAI model name")
    parser.add_argument("--timeout-seconds", type=int, default=45, help="OpenAI HTTP timeout")
    parser.add_argument("--fallback-only", action="store_true", help="Skip OpenAI call and write deterministic fallback")
    args = parser.parse_args()

    context_path = Path(args.context_file).resolve()
    output_path = Path(args.output).resolve()

    try:
        context = load_context(context_path)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    summary_text = ""

    if not args.fallback_only:
        try:
            summary_text = try_openai_summary(context=context, model=args.model, timeout=args.timeout_seconds)
        except Exception as exc:
            print(f"OpenAI generation unavailable, using fallback: {exc}", file=sys.stderr)

    if not summary_text.strip():
        summary_text = build_fallback_summary(context)
    else:
        try:
            assert_hungarian_diacritics(summary_text)
        except Exception as exc:
            print(f"Generated summary failed HU diacritics check, using fallback: {exc}", file=sys.stderr)
            summary_text = build_fallback_summary(context)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(summary_text.strip() + "\n", encoding="utf-8")
    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
