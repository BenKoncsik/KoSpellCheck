import fs from 'node:fs';
import path from 'node:path';

export type SupportedUiLanguage = 'en' | 'hu';
export type ConfiguredUiLanguage = 'auto' | 'en' | 'hu';

interface SharedCatalogFile {
  defaultLanguage?: string;
  languages?: Record<string, Record<string, string>>;
}

const DEFAULT_LANGUAGE: SupportedUiLanguage = 'en';
const SHARED_CATALOG_RELATIVE_PATH = path.join('resources', 'i18n', 'shared-ui-strings.json');

let hostLanguage: SupportedUiLanguage = DEFAULT_LANGUAGE;
let configuredDefaultLanguage: SupportedUiLanguage = DEFAULT_LANGUAGE;
let catalogByLanguage: Record<SupportedUiLanguage, Record<string, string>> = {
  en: {},
  hu: {}
};

export function initializeSharedUiText(extensionPath: string, hostLocale?: string): void {
  hostLanguage = toSupportedLanguage(hostLocale);
  const catalogPath = path.join(extensionPath, SHARED_CATALOG_RELATIVE_PATH);

  if (!fs.existsSync(catalogPath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(catalogPath, 'utf8');
    const parsed = JSON.parse(raw) as SharedCatalogFile;
    const languages = parsed.languages ?? {};

    const en = safeLanguageMap(languages.en);
    const hu = safeLanguageMap(languages.hu);

    catalogByLanguage = {
      en,
      hu
    };
    configuredDefaultLanguage = toSupportedLanguage(parsed.defaultLanguage);
  } catch {
    // fall back to built-in defaults (key fallback strings)
  }
}

export function normalizeConfiguredUiLanguage(value: unknown): ConfiguredUiLanguage {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'auto';
  }

  switch (value.trim().toLowerCase()) {
    case 'auto':
    case 'system':
      return 'auto';
    case 'en':
    case 'eng':
    case 'english':
      return 'en';
    case 'hu':
    case 'hun':
    case 'hungarian':
    case 'magyar':
      return 'hu';
    default:
      return 'auto';
  }
}

export function resolveUiLanguage(configuredLanguage: unknown): SupportedUiLanguage {
  const normalized = normalizeConfiguredUiLanguage(configuredLanguage);
  return normalized === 'auto' ? hostLanguage : normalized;
}

export function text(
  key: string,
  fallback: string,
  options?: {
    configuredLanguage?: unknown;
    language?: SupportedUiLanguage;
    args?: Record<string, unknown>;
  }
): string {
  const language = options?.language ?? resolveUiLanguage(options?.configuredLanguage);
  const template =
    catalogByLanguage[language]?.[key] ??
    catalogByLanguage[configuredDefaultLanguage]?.[key] ??
    fallback;

  return formatTemplate(template, options?.args);
}

function formatTemplate(template: string, args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return template;
  }

  return template.replace(/\{([A-Za-z0-9_.-]+)\}/gu, (_, token: string) => {
    const value = args[token];
    if (value === undefined || value === null) {
      return '';
    }

    return String(value);
  });
}

function safeLanguageMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string' || key.trim().length === 0 || raw.trim().length === 0) {
      continue;
    }

    output[key.trim()] = raw;
  }

  return output;
}

function toSupportedLanguage(value: unknown): SupportedUiLanguage {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_LANGUAGE;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('hu')) {
    return 'hu';
  }

  return 'en';
}
