#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Sequence

import numpy as np
import tensorflow as tf

FEATURE_NAMES = [
    'distance',
    'similarity',
    'identifier_context',
    'literal_context',
    'long_token',
    'short_token',
    'looks_domain_like',
    'has_suggestion',
    'token_has_non_ascii',
    'suggestion_has_non_ascii',
    'same_first_char',
    'same_last_char',
    'accents_only_difference',
    'normalized_length_delta'
]
LABELS = ['IdentifierTypo', 'TextTypo', 'NotTypo']
LABEL_TO_INDEX = {label: index for index, label in enumerate(LABELS)}
DEFAULT_SEED = 1337
DEFAULT_TOP1_THRESHOLD = {
    'balanced': 0.60,
    'precision': 0.72,
    'recall': 0.54
}
DEFAULT_MARGIN_THRESHOLD = {
    'balanced': 0.10,
    'precision': 0.18,
    'recall': 0.07
}
IDENTIFIER_SUFFIXES = ['Service', 'Token', 'Value', 'Check', 'Spell']
HARD_NEGATIVE_SUFFIXES = ['2', '_id', 'HTTP', 'USB']
TOKEN_RE = re.compile(r"[\w\-']+", re.UNICODE)
MAX_DISTANCE = 4
ACCENT_TRANSLATION = str.maketrans({
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ö': 'o', 'ő': 'o',
    'ú': 'u', 'ü': 'u', 'ű': 'u',
    'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ö': 'o', 'Ő': 'o',
    'Ú': 'u', 'Ü': 'u', 'Ű': 'u'
})
CHAR_REPLACEMENTS = {
    'a': ['á', 's', 'q'],
    'e': ['é', 'r', 'w'],
    'i': ['í', 'o', 'u'],
    'o': ['ó', 'ö', 'ő', 'i', 'p'],
    'u': ['ú', 'ü', 'ű', 'i', 'y'],
    'c': ['x', 'v', 'k'],
    'k': ['j', 'l', 'c'],
    's': ['a', 'd', 'z'],
    'z': ['x', 's'],
    'n': ['b', 'm'],
    't': ['r', 'y'],
    'h': ['g', 'j'],
    'r': ['e', 't'],
    'l': ['k']
}


@dataclass(frozen=True)
class Example:
    token: str
    suggestion: str
    context: str
    label: str


def stable_hash(value: str) -> int:
    return int(hashlib.sha1(value.encode('utf-8')).hexdigest()[:12], 16)


def fail(message: str) -> None:
    raise SystemExit(f'Error: {message}')


def sanitize_model_id(raw: str) -> str:
    normalized = re.sub(r'[^a-z0-9._-]+', '_', raw.strip().lower())
    normalized = re.sub(r'_+', '_', normalized).strip('_-')
    if not normalized:
        fail('invalid --model-id')
    return normalized


def normalize(value: str) -> str:
    return ''.join(ch.lower() for ch in value if not ch.isspace())


def contains_non_ascii(value: str) -> bool:
    return any(ord(ch) > 127 for ch in value)


def fold_huen_accents(value: str) -> str:
    return value.translate(ACCENT_TRANSLATION).lower()


def looks_domain_like(token: str) -> bool:
    if len(token) <= 1:
        return True
    has_digit = any(ch.isdigit() for ch in token)
    has_upper = any(ch.isupper() for ch in token)
    has_lower = any(ch.islower() for ch in token)
    if '_' in token or '-' in token:
        return True
    if has_digit and has_upper:
        return True
    return len(token) >= 8 and has_upper and has_lower and ' ' not in token


def bounded_damerau_levenshtein(left: str, right: str, max_distance: int = MAX_DISTANCE) -> int:
    left_len = len(left)
    right_len = len(right)
    if abs(left_len - right_len) > max_distance:
        return max_distance + 1

    prev_prev = list(range(right_len + 1))
    prev = list(range(right_len + 1))
    cur = [0] * (right_len + 1)

    for i in range(1, left_len + 1):
        cur[0] = i
        min_in_row = cur[0]
        for j in range(1, right_len + 1):
            cost = 0 if left[i - 1] == right[j - 1] else 1
            deletion = prev[j] + 1
            insertion = cur[j - 1] + 1
            substitution = prev[j - 1] + cost
            value = min(deletion, insertion, substitution)
            if i > 1 and j > 1 and left[i - 1] == right[j - 2] and left[i - 2] == right[j - 1]:
                value = min(value, prev_prev[j - 2] + 1)
            cur[j] = value
            min_in_row = min(min_in_row, value)
        if min_in_row > max_distance:
            return max_distance + 1
        prev_prev, prev, cur = prev, cur, [0] * (right_len + 1)

    return prev[right_len]


def feature_vector(token: str, suggestion: str, context: str) -> np.ndarray:
    token_norm = normalize(token)
    suggestion_norm = normalize(suggestion)
    distance = bounded_damerau_levenshtein(token_norm, suggestion_norm, MAX_DISTANCE)
    max_len = float(max(len(token_norm), len(suggestion_norm)))
    similarity = 1.0 if max_len == 0 else 1.0 - (distance / max_len)
    token_folded = fold_huen_accents(token)
    suggestion_folded = fold_huen_accents(suggestion)
    same_first = bool(token_norm and suggestion_norm and token_norm[0] == suggestion_norm[0])
    same_last = bool(token_norm and suggestion_norm and token_norm[-1] == suggestion_norm[-1])
    accents_only_difference = (
        bool(token_norm)
        and bool(suggestion_norm)
        and token_norm != suggestion_norm
        and token_folded == suggestion_folded
    )
    normalized_length_delta = 0.0 if max_len == 0 else abs(len(token_norm) - len(suggestion_norm)) / max_len
    return np.asarray([
        float(distance),
        float(similarity),
        1.0 if context == 'identifier' else 0.0,
        1.0 if context == 'literal' else 0.0,
        1.0 if len(token_norm) >= 9 else 0.0,
        1.0 if len(token_norm) <= 3 else 0.0,
        1.0 if looks_domain_like(token) else 0.0,
        1.0 if bool(suggestion) else 0.0,
        1.0 if contains_non_ascii(token) else 0.0,
        1.0 if contains_non_ascii(suggestion) else 0.0,
        1.0 if same_first else 0.0,
        1.0 if same_last else 0.0,
        1.0 if accents_only_difference else 0.0,
        float(normalized_length_delta)
    ], dtype=np.float32)


def is_letter_like(ch: str) -> bool:
    category = unicodedata.category(ch)
    return category.startswith('L') or category.startswith('M')


def clean_dictionary_token(raw: str) -> str | None:
    token = raw.strip()
    if not token:
        return None
    token = token.split('/', 1)[0].strip()
    token = token.strip()
    if len(token) < 2 or len(token) > 24:
        return None
    if token.isupper() and len(token) > 4:
        return None
    for ch in token:
        if ch in "'-":
            continue
        if not is_letter_like(ch):
            return None
    return token


def load_dictionary_words(path: Path) -> list[str]:
    if not path.exists():
        return []
    words: list[str] = []
    with path.open('r', encoding='utf-8', errors='ignore') as handle:
        for index, line in enumerate(handle):
            if index == 0 and line.strip().isdigit():
                continue
            token = clean_dictionary_token(line)
            if token:
                words.append(token)
    return words


def tokenize_corpus(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in TOKEN_RE.findall(text):
        cleaned = clean_dictionary_token(raw)
        if cleaned:
            tokens.append(cleaned)
    return tokens


def sample_words(words: Iterable[str], limit: int | None) -> list[str]:
    unique = sorted({word for word in words}, key=lambda item: (stable_hash(item), item))
    if limit is None or limit <= 0 or len(unique) <= limit:
        return unique
    return unique[:limit]


def pick_middle_index(value: str) -> int:
    if len(value) <= 2:
        return 0
    return max(1, min(len(value) - 2, len(value) // 2))


def delete_variant(value: str) -> str | None:
    if len(value) < 4:
        return None
    index = pick_middle_index(value)
    return value[:index] + value[index + 1:]


def transpose_variant(value: str) -> str | None:
    if len(value) < 4:
        return None
    index = pick_middle_index(value)
    if index >= len(value) - 1:
        index = len(value) - 2
    if index < 0 or index + 1 >= len(value):
        return None
    chars = list(value)
    chars[index], chars[index + 1] = chars[index + 1], chars[index]
    return ''.join(chars)


def duplicate_variant(value: str) -> str | None:
    if len(value) < 3:
        return None
    index = pick_middle_index(value)
    return value[:index] + value[index] + value[index:]


def substitute_variant(value: str) -> str | None:
    if len(value) < 3:
        return None
    index = pick_middle_index(value)
    original = value[index]
    candidates = CHAR_REPLACEMENTS.get(original.lower(), [])
    if not candidates:
        if original.lower() != 'e':
            replacement = 'e'
        else:
            replacement = 'a'
        candidates = [replacement]
    replacement = candidates[stable_hash(value) % len(candidates)]
    if original.isupper():
        replacement = replacement.upper()
    if replacement == original:
        return None
    return value[:index] + replacement + value[index + 1:]


def accent_fold_variant(value: str) -> str | None:
    folded = value.translate(ACCENT_TRANSLATION)
    if folded.lower() == value.lower() and folded == value:
        return None
    return folded


def camel_identifier_base(word: str) -> str | None:
    if not word.isascii() or not word.isalpha() or len(word) < 4 or len(word) > 12:
        return None
    suffix = IDENTIFIER_SUFFIXES[stable_hash(word) % len(IDENTIFIER_SUFFIXES)]
    return word[:1].upper() + word[1:] + suffix


def snake_identifier_base(word: str) -> str | None:
    if not word.isascii() or not word.isalpha() or len(word) < 4 or len(word) > 12:
        return None
    return f'{word.lower()}_value'


def generate_typo_variants(value: str) -> list[str]:
    variants = [
        delete_variant(value),
        transpose_variant(value),
        duplicate_variant(value),
        substitute_variant(value),
        accent_fold_variant(value)
    ]
    output: list[str] = []
    seen = set()
    for variant in variants:
        if not variant or variant == value or len(variant) < 2:
            continue
        if variant in seen:
            continue
        seen.add(variant)
        output.append(variant)
    return output


def generate_identifier_hard_negatives(base: str) -> list[str]:
    output: list[str] = []
    seen = set()
    suffix = HARD_NEGATIVE_SUFFIXES[stable_hash(base) % len(HARD_NEGATIVE_SUFFIXES)]
    for candidate in [f'{base}{suffix}', f'{base.upper()}2' if base.isascii() else None]:
        if not candidate or candidate == base:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        output.append(candidate)
    return output


def generate_examples(words: Sequence[str]) -> list[Example]:
    examples: list[Example] = []
    seen = set()

    def add(token: str, suggestion: str, context: str, label: str) -> None:
        key = (token, suggestion, context, label)
        if key in seen:
            return
        seen.add(key)
        examples.append(Example(token=token, suggestion=suggestion, context=context, label=label))

    for word in words:
        add(word, word, 'literal', 'NotTypo')
        add(word, word, 'identifier', 'NotTypo')

        accent_variant = accent_fold_variant(word)
        if accent_variant and accent_variant != word:
            add(accent_variant, word, 'literal', 'TextTypo')
            add(accent_variant, word, 'identifier', 'NotTypo')

        for typo in generate_typo_variants(word):
            if typo == accent_variant:
                continue
            add(typo, word, 'literal', 'TextTypo')
            add(typo, word, 'identifier', 'IdentifierTypo')

        for identifier_base in [camel_identifier_base(word), snake_identifier_base(word)]:
            if not identifier_base:
                continue
            add(identifier_base, identifier_base, 'identifier', 'NotTypo')
            for typo in generate_typo_variants(identifier_base):
                add(typo, identifier_base, 'identifier', 'IdentifierTypo')
            for hard_negative in generate_identifier_hard_negatives(identifier_base):
                add(hard_negative, identifier_base, 'identifier', 'NotTypo')

    return examples


def vectorize_examples(examples: Sequence[Example]) -> tuple[np.ndarray, np.ndarray]:
    features = np.stack([feature_vector(item.token, item.suggestion, item.context) for item in examples])
    labels = np.asarray([LABEL_TO_INDEX[item.label] for item in examples], dtype=np.int32)
    return features.astype(np.float32), labels


def class_weight_for_preset(preset: str) -> dict[int, float]:
    if preset == 'precision':
        return {
            LABEL_TO_INDEX['IdentifierTypo']: 0.95,
            LABEL_TO_INDEX['TextTypo']: 0.95,
            LABEL_TO_INDEX['NotTypo']: 1.15
        }
    if preset == 'recall':
        return {
            LABEL_TO_INDEX['IdentifierTypo']: 1.10,
            LABEL_TO_INDEX['TextTypo']: 1.10,
            LABEL_TO_INDEX['NotTypo']: 0.90
        }
    return {
        LABEL_TO_INDEX['IdentifierTypo']: 1.0,
        LABEL_TO_INDEX['TextTypo']: 1.0,
        LABEL_TO_INDEX['NotTypo']: 1.0
    }


def build_model(seed: int) -> tf.keras.Model:
    tf.keras.utils.set_random_seed(seed)
    optimizer_factory = getattr(tf.keras.optimizers, 'legacy', tf.keras.optimizers)
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(len(FEATURE_NAMES),), dtype=tf.float32),
        tf.keras.layers.Dense(24, activation='relu'),
        tf.keras.layers.Dense(12, activation='relu'),
        tf.keras.layers.Dense(len(LABELS), activation='softmax')
    ])
    model.compile(
        optimizer=optimizer_factory.Adam(learning_rate=0.003),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=['accuracy']
    )
    return model


def representative_dataset(features: np.ndarray) -> Iterator[list[np.ndarray]]:
    limit = min(512, len(features))
    if limit <= 0:
        return iter(())
    for index in np.linspace(0, len(features) - 1, num=limit, dtype=int):
        yield [features[index:index + 1].astype(np.float32)]


def convert_to_tflite(model: tf.keras.Model, features: np.ndarray) -> bytes:
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = lambda: representative_dataset(features)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    return converter.convert()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def to_posix_path(value: Path) -> str:
    return value.as_posix()


def relative_from_manifest(manifest_path: Path, target_path: Path) -> str:
    return to_posix_path(target_path.relative_to(manifest_path.parent)) if target_path.is_relative_to(manifest_path.parent) else to_posix_path(Path(os.path.relpath(target_path, manifest_path.parent)))


def upsert_manifest_file(manifest: dict, entry: dict) -> None:
    files = manifest.setdefault('files', [])
    for index, item in enumerate(files):
        if item.get('path') == entry['path']:
            files[index] = entry
            return
    files.append(entry)


def upsert_manifest_model(manifest: dict, entry: dict, set_default: bool) -> None:
    models = manifest.setdefault('models', [])
    for index, item in enumerate(models):
        if item.get('id') == entry['id']:
            models[index] = entry
            break
    else:
        models.append(entry)
    if set_default:
        for model in models:
            model['default'] = model.get('id') == entry['id']


def maybe_compile_edgetpu(model_path: Path, enabled: bool) -> tuple[bool, str | None]:
    if not enabled:
        return False, None
    compiler = shutil.which('edgetpu_compiler')
    if not compiler:
        return False, 'edgetpu_compiler not found in PATH'
    workdir = model_path.parent
    process = subprocess.run(
        [compiler, '-s', '-o', str(workdir), str(model_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False
    )
    compiled_path = model_path.with_name(f'{model_path.stem}_edgetpu.tflite')
    if process.returncode != 0:
        return False, process.stdout.strip() or f'edgetpu_compiler exit={process.returncode}'
    if not compiled_path.exists():
        return False, 'edgetpu_compiler did not produce expected _edgetpu output'
    compiled_bytes = compiled_path.read_bytes()
    model_path.write_bytes(compiled_bytes)
    compiled_path.unlink(missing_ok=True)
    return True, process.stdout.strip() or None


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='KoSpellCheck HU+EN TFLite typo model builder')
    subparsers = parser.add_subparsers(dest='command', required=True)

    build = subparsers.add_parser('build', help='Train and export a quantized TFLite model')
    build.add_argument('--input', help='Optional training text to bias the model toward project vocabulary')
    build.add_argument('--model-id', help='Model identifier')
    build.add_argument('--display-name', help='Human-readable model name')
    build.add_argument('--file-name', help='Optional output file name without extension')
    build.add_argument('--description', help='Model description')
    build.add_argument('--preset', choices=['balanced', 'precision', 'recall'], default='balanced')
    build.add_argument('--outdir', default='Coral-tpu/MacOs/Models')
    build.add_argument('--manifest', default='Coral-tpu/MacOs/runtime-manifest.json')
    build.add_argument('--add-to-manifest', action='store_true')
    build.add_argument('--set-default', action='store_true')
    build.add_argument('--dictionary-root', default='tools/dictionaries')
    build.add_argument('--languages', default='hu,en')
    build.add_argument('--max-words-per-language', type=int, default=40000)
    build.add_argument('--seed', type=int, default=DEFAULT_SEED)
    build.add_argument('--compile-edgetpu', action='store_true')
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    if args.command != 'build':
        fail(f'unknown command: {args.command}')

    repo_root = Path(__file__).resolve().parents[2]
    input_path = Path(args.input).resolve() if args.input else None
    if input_path and not input_path.exists():
        fail(f'input not found: {input_path}')

    language_codes = [item.strip().lower() for item in str(args.languages).split(',') if item.strip()]
    if not language_codes:
        fail('at least one language is required')

    dictionary_root = (repo_root / args.dictionary_root).resolve()
    per_language_words: dict[str, list[str]] = {}
    if 'hu' in language_codes:
        per_language_words['hu'] = sample_words(
            load_dictionary_words(dictionary_root / 'hu_HU' / 'hu_HU.dic'),
            args.max_words_per_language
        )
    if 'en' in language_codes:
        per_language_words['en'] = sample_words(
            load_dictionary_words(dictionary_root / 'en_US' / 'en_US.dic'),
            args.max_words_per_language
        )

    extra_tokens: list[str] = []
    if input_path:
        extra_tokens = tokenize_corpus(input_path.read_text(encoding='utf-8', errors='ignore'))

    all_words: list[str] = []
    for words in per_language_words.values():
        all_words.extend(words)
    all_words.extend(sample_words(extra_tokens, 15000))
    all_words = sample_words(all_words, None)
    if not all_words:
        fail('no usable training words found')

    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.keras.utils.set_random_seed(args.seed)

    examples = generate_examples(all_words)
    if len(examples) < 100:
        fail('not enough generated training examples')

    features, labels = vectorize_examples(examples)
    indices = np.arange(len(features))
    rng = np.random.default_rng(args.seed)
    rng.shuffle(indices)
    features = features[indices]
    labels = labels[indices]

    split_index = max(int(len(features) * 0.9), 1)
    x_train = features[:split_index]
    y_train = labels[:split_index]
    x_val = features[split_index:] if split_index < len(features) else features[:1]
    y_val = labels[split_index:] if split_index < len(labels) else labels[:1]

    model = build_model(args.seed)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=3, restore_best_weights=True)
    ]
    history = model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=18,
        batch_size=512,
        verbose=0,
        callbacks=callbacks,
        class_weight=class_weight_for_preset(args.preset)
    )

    evaluation = model.evaluate(x_val, y_val, verbose=0, return_dict=True)
    tflite_bytes = convert_to_tflite(model, x_train)

    model_id = sanitize_model_id(args.model_id or (input_path.stem if input_path else f'huen_{args.preset}'))
    file_name = sanitize_model_id(args.file_name or model_id)
    display_name = (args.display_name or f'{model_id} ({args.preset})').strip()
    description = (
        args.description
        or 'Real int8 TFLite typo classifier trained from HU+EN dictionaries and optional local text.'
    ).strip()

    outdir = (repo_root / args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    model_path = outdir / f'{file_name}.tflite'
    meta_path = Path(f'{model_path}.meta.json')
    model_path.write_bytes(tflite_bytes)

    compiled, compile_detail = maybe_compile_edgetpu(model_path, args.compile_edgetpu)
    if compiled:
        tflite_bytes = model_path.read_bytes()

    label_distribution = Counter(LABELS[item] for item in labels.tolist())
    created_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    meta = {
        'schemaVersion': 2,
        'id': model_id,
        'displayName': display_name,
        'description': description,
        'preset': args.preset,
        'createdAtUtc': created_at,
        'languages': language_codes,
        'labels': LABELS,
        'inputFeatureNames': FEATURE_NAMES,
        'inputFeatureCount': len(FEATURE_NAMES),
        'quantization': {
            'inputType': 'int8',
            'outputType': 'int8'
        },
        'uncertainTop1Threshold': DEFAULT_TOP1_THRESHOLD[args.preset],
        'uncertainMarginThreshold': DEFAULT_MARGIN_THRESHOLD[args.preset],
        'edgeTpuCompilerReady': True,
        'edgeTpuCompiled': compiled,
        'edgeTpuCompilerDetail': compile_detail,
        'sources': {
            'dictionaryRoot': str(dictionary_root),
            'dictionaryCounts': {language: len(words) for language, words in per_language_words.items()},
            'extraInputFile': str(input_path) if input_path else None,
            'extraInputTokenCount': len(extra_tokens)
        },
        'training': {
            'exampleCount': int(len(examples)),
            'classDistribution': dict(label_distribution),
            'epochsCompleted': int(len(history.history.get('loss', []))),
            'validationAccuracy': float(evaluation.get('accuracy', 0.0)),
            'validationLoss': float(evaluation.get('loss', 0.0)),
            'seed': args.seed
        }
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    manifest_updated = False
    manifest_path = (repo_root / args.manifest).resolve()
    model_sha = sha256_hex(model_path.read_bytes())
    meta_sha = sha256_hex(meta_path.read_bytes())
    if args.add_to_manifest:
        if not manifest_path.exists():
            fail(f'manifest not found: {manifest_path}')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        model_rel = relative_from_manifest(manifest_path, model_path)
        meta_rel = relative_from_manifest(manifest_path, meta_path)
        upsert_manifest_file(manifest, {
            'path': model_rel,
            'url': model_rel,
            'sha256': model_sha
        })
        upsert_manifest_file(manifest, {
            'path': meta_rel,
            'url': meta_rel,
            'sha256': meta_sha
        })
        upsert_manifest_model(manifest, {
            'id': model_id,
            'displayName': display_name,
            'path': model_rel,
            'format': 'edgetpu-ready-int8' if not compiled else 'edgetpu-tflite',
            'description': description,
            'default': bool(args.set_default)
        }, bool(args.set_default))
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        manifest_updated = True

    print('Model generated successfully.')
    print(f'- model: {model_path}')
    print(f'- meta: {meta_path}')
    print(f'- examples: {len(examples)}')
    print(f'- validation accuracy: {evaluation.get("accuracy", 0.0):.4f}')
    print(f'- validation loss: {evaluation.get("loss", 0.0):.4f}')
    print(f'- sha256 model: {model_sha}')
    print(f'- sha256 meta: {meta_sha}')
    print(f'- edge tpu compiled: {compiled}')
    if compile_detail:
        print(f'- edge tpu compiler detail: {compile_detail}')
    if manifest_updated:
        print(f'- manifest updated: {manifest_path}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
