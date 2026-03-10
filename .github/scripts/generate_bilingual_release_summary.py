#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def first_n(items: List[Any], n: int) -> List[Any]:
    return items[:n] if len(items) > n else items


def fallback_summary(context: Dict[str, Any]) -> str:
    latest = context.get("latest_release", {})
    previous = context.get("previous_release", {})
    git_analysis = context.get("git_analysis") or {}

    latest_tag = latest.get("tag") or "unknown"
    previous_tag = previous.get("tag")
    range_text = git_analysis.get("range") or (f"{previous_tag}..{latest_tag}" if previous_tag else f"baseline..{latest_tag}")
    shortstat = git_analysis.get("shortstat") or "No git diff stats available"
    top_paths = first_n(git_analysis.get("top_paths") or [], 5)
    commits = first_n(git_analysis.get("commits") or [], 8)

    top_paths_en = "\n".join([f"- `{row.get('segment')}`: {row.get('changed_files')} files" for row in top_paths]) or "- No path-level stats available"
    top_paths_hu = "\n".join([f"- `{row.get('segment')}`: {row.get('changed_files')} fájl" for row in top_paths]) or "- Nincs útvonal szintű statisztika"
    commits_en = "\n".join([f"- {c.get('subject', '').strip()}" for c in commits]) or "- No commit samples available"
    commits_hu = "\n".join([f"- {c.get('subject', '').strip()}" for c in commits]) or "- Nincs commit minta"

    return f"""## English

### What changed
- Release range: `{range_text}`
- Diff stats: {shortstat}

### New features
- Review commit subjects below for feature additions.

### Fixes and quality improvements
- The same commit list may include bug fixes, refactors, tests, and maintenance changes.

### Potential impact and migration notes
- Verify manually whether configuration, APIs, or behavior changed.

### Evidence
{top_paths_en}

Representative commits:
{commits_en}

## Magyar

### Mi változott
- Release tartomány: `{range_text}`
- Diff statisztika: {shortstat}

### Új funkciók
- Az alábbi commit címek alapján azonosíthatók a funkcióbővítések.

### Hibajavítások és minőségi fejlesztések
- Ugyanez a commit lista tartalmazhat hibajavítást, refaktort, tesztet és karbantartást.

### Várható hatás és migrációs megjegyzések
- Kézi ellenőrzés javasolt a konfigurációs/API/viselkedésbeli változásokhoz.

### Bizonyíték
{top_paths_hu}

Reprezentatív commitok:
{commits_hu}
"""


def build_prompt(context: Dict[str, Any]) -> str:
    slim = {
        "owner_repo": context.get("owner_repo"),
        "latest_release": context.get("latest_release"),
        "previous_release": context.get("previous_release"),
        "git_analysis": {
            "range": (context.get("git_analysis") or {}).get("range"),
            "shortstat": (context.get("git_analysis") or {}).get("shortstat"),
            "top_paths": first_n((context.get("git_analysis") or {}).get("top_paths") or [], 12),
            "commits": first_n((context.get("git_analysis") or {}).get("commits") or [], 40),
            "changed_files": first_n((context.get("git_analysis") or {}).get("changed_files") or [], 80),
        },
    }

    return (
        "Create a concise bilingual release summary in Markdown based only on the provided data.\n"
        "Requirements:\n"
        "1) Output exactly two top-level sections: '## English' and '## Magyar'.\n"
        "2) In both languages include these headings: '### What changed'/'### Mi változott', "
        "'### New features'/'### Új funkciók', '### Fixes and quality improvements'/'### Hibajavítások és minőségi fejlesztések', "
        "'### Potential impact and migration notes'/'### Várható hatás és migrációs megjegyzések'.\n"
        "3) Ground every claim in commits/files/release metadata. Avoid speculation.\n"
        "4) Mention release range and shortstat when available.\n"
        "5) Keep product, API, class, and file names unchanged.\n\n"
        "Context JSON:\n"
        f"{json.dumps(slim, ensure_ascii=False, indent=2)}"
    )


def call_openai(prompt: str, model: str, api_key: str) -> str:
    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": "You write release summaries for engineers. Be precise and evidence-based.",
                    }
                ],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            },
        ],
        "temperature": 0.2,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=90) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    if isinstance(body.get("output_text"), str) and body["output_text"].strip():
        return body["output_text"].strip()

    chunks: List[str] = []
    for out in body.get("output", []):
        for content in out.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                chunks.append(content["text"])
    text = "\n".join(chunks).strip()
    if not text:
        raise RuntimeError("OpenAI response did not contain output text")
    return text


def ensure_contract(text: str) -> str:
    has_en = "## English" in text
    has_hu = "## Magyar" in text
    if has_en and has_hu:
        return text.strip() + "\n"

    return (
        "## English\n\n"
        "### What changed\n"
        "- Generated summary did not match contract; see content below.\n\n"
        "### New features\n- See note below.\n\n"
        "### Fixes and quality improvements\n- See note below.\n\n"
        "### Potential impact and migration notes\n- Validate manually.\n\n"
        "## Magyar\n\n"
        "### Mi változott\n"
        "- A generált összefoglaló nem felelt meg a szerződésnek; lásd alább.\n\n"
        "### Új funkciók\n- Lásd az alábbi megjegyzést.\n\n"
        "### Hibajavítások és minőségi fejlesztések\n- Lásd az alábbi megjegyzést.\n\n"
        "### Várható hatás és migrációs megjegyzések\n- Kézi ellenőrzés javasolt.\n\n"
        "### Raw output\n\n"
        f"{text.strip()}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate bilingual release summary markdown.")
    parser.add_argument("--input", required=True, help="Path to release context JSON")
    parser.add_argument("--output", required=True, help="Path to markdown output")
    args = parser.parse_args()

    context = load_json(Path(args.input))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"

    if not api_key:
        text = fallback_summary(context)
        output_path.write_text(text.strip() + "\n", encoding="utf-8")
        print("OPENAI_API_KEY is missing; wrote fallback summary.", file=sys.stderr)
        return 0

    prompt = build_prompt(context)
    try:
        summary = call_openai(prompt=prompt, model=model, api_key=api_key)
        output_path.write_text(ensure_contract(summary), encoding="utf-8")
        return 0
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"OpenAI HTTP error: {exc.code} {detail}", file=sys.stderr)
    except Exception as exc:
        print(f"OpenAI generation failed: {exc}", file=sys.stderr)

    output_path.write_text(fallback_summary(context).strip() + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
