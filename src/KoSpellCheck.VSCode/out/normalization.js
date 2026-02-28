"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalize = normalize;
exports.asciiFold = asciiFold;
exports.isAsciiOnly = isAsciiOnly;
exports.isAllCaps = isAllCaps;
function normalize(token) {
    return token.normalize('NFKC').toLowerCase();
}
function asciiFold(value) {
    return value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\x00-\x7F]/g, '')
        .toLowerCase();
}
function isAsciiOnly(value) {
    return /^[\x00-\x7F]+$/.test(value);
}
function isAllCaps(value) {
    const letters = value.replace(/[^A-Za-z]/g, '');
    return letters.length > 0 && letters === letters.toUpperCase();
}
//# sourceMappingURL=normalization.js.map