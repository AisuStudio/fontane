export type CharacterSet = {
  id: string;
  label: string;
  chars: string[];
};

const LATIN_BASIC: string[] = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
];

// Common accented Latin letters used across Central European languages —
// Polish, Czech, Slovak, Hungarian, German, Croatian, Romanian. Not a strict
// ISO-8859-2/Latin-2 reproduction, just the diacritics that actually show up
// across those languages' alphabets.
const CENTRAL_EUROPEAN_EXTRA: string[] = [
  // Polish
  "ą", "Ą", "ć", "Ć", "ę", "Ę", "ł", "Ł", "ń", "Ń", "ó", "Ó", "ś", "Ś", "ź", "Ź", "ż", "Ż",
  // Czech / Slovak
  "č", "Č", "ď", "Ď", "ě", "Ě", "ň", "Ň", "ř", "Ř", "š", "Š", "ť", "Ť", "ů", "Ů", "ž", "Ž",
  "ĺ", "Ĺ", "ŕ", "Ŕ",
  // Hungarian
  "ő", "Ő", "ű", "Ű",
  // German
  "ä", "Ä", "ö", "Ö", "ü", "Ü", "ß",
  // Acutes shared across several Central European languages
  "á", "Á", "é", "É", "í", "Í", "ú", "Ú", "ý", "Ý",
  // Croatian / Romanian
  "đ", "Đ", "â", "Â", "ă", "Ă", "î", "Î", "ş", "Ş", "ţ", "Ţ",
];

const NUMBERS: string[] = "0123456789".split("");

// Common punctuation actually needed for handwritten text — not an
// exhaustive symbol set, just what shows up in ordinary sentences.
const PUNCTUATION: string[] = [
  ".", ",", "!", "?", ":", ";",
  "'", "‘", "’", "\"", "“", "”",
  "-", "–", "—",
  "(", ")", "/", "&", "@",
];

// Add more sets here (e.g. Cyrillic) as their own entry — the grid UI picks
// up any set added to this list automatically.
export const CHARACTER_SETS: CharacterSet[] = [
  { id: "latin-basic", label: "Latin Basic", chars: LATIN_BASIC },
  { id: "central-european", label: "Central European", chars: CENTRAL_EUROPEAN_EXTRA },
  { id: "numbers", label: "Numbers", chars: NUMBERS },
  { id: "punctuation", label: "Punctuation", chars: PUNCTUATION },
];

export const DEFAULT_CHARACTER_SET_IDS = ["latin-basic", "central-european", "numbers", "punctuation"];
