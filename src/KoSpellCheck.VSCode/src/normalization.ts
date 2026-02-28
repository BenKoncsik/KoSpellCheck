export function normalize(token: string): string {
  return token.normalize('NFKC').toLowerCase();
}

export function asciiFold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase();
}

export function isAsciiOnly(value: string): boolean {
  return /^[\x00-\x7F]+$/.test(value);
}

export function isAllCaps(value: string): boolean {
  const letters = value.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}
