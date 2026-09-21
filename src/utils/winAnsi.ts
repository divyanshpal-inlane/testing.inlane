/**
 * pdf-lib's standard fonts (Helvetica etc.) can only encode WinAnsi (cp1252)
 * text; anything else throws "WinAnsi cannot encode ...". Learner data pasted
 * from sheets sometimes carries Cyrillic/Greek homoglyphs (e.g. Н for H) or
 * other Unicode, so sanitise every string before measuring or drawing it.
 */

// Look-alike characters mapped to their Latin equivalents.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic uppercase
  А: "A",
  В: "B",
  Е: "E",
  З: "3",
  И: "N",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
  Ѕ: "S",
  І: "I",
  Ј: "J",
  // Cyrillic lowercase
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  ѕ: "s",
  і: "i",
  ј: "j",
  // Greek
  Α: "A",
  Β: "B",
  Ε: "E",
  Ζ: "Z",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Υ: "Y",
  Χ: "X",
  ο: "o",
  // Dashes/quotes outside cp1252
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "-",
  "−": "-",
  ʼ: "'",
  "′": "'",
  "″": '"',
};

// cp1252 codepoints beyond Latin-1 (the 0x80–0x9F block).
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

const isWinAnsi = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x20 && c <= 0x7e) ||
    (c >= 0xa0 && c <= 0xff) ||
    CP1252_EXTRA.includes(ch)
  );
};

/**
 * Best-effort conversion to WinAnsi-encodable text: homoglyphs become their
 * Latin twins, accented letters lose unsupported diacritics, exotic spaces
 * collapse to plain spaces and anything still unencodable is dropped.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isWinAnsi(ch)) {
      out += ch;
      continue;
    }
    const mapped = HOMOGLYPHS[ch];
    if (mapped) {
      out += mapped;
      continue;
    }
    if (/\s/.test(ch)) {
      out += " ";
      continue;
    }
    // Decompose (é → e + ́ ) and keep whatever becomes encodable.
    for (const part of ch.normalize("NFKD")) {
      if (isWinAnsi(part)) out += part;
      else if (HOMOGLYPHS[part]) out += HOMOGLYPHS[part];
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
