import { BASIC_CONSONANTS, BASIC_VOWELS } from "./hangul";

// Which writing system a set belongs to. Not a taxonomy for its own sake —
// it decides cell geometry: Latin, Cyrillic and Greek all sit on the same
// baseline with an x-height above it, so they share one Grid tab and one set
// of metrics. Hangul doesn't have a baseline at all; a syllable fills a
// square em box. Those two facts can't live in the same grid.
export type ScriptId = "latin" | "hangul";

export type Script = {
  id: ScriptId;
  label: string;
  // Cell height as a multiple of cell width. Latin cells are portrait to
  // leave room for ascenders/descenders; a Hangul cell is the em square.
  aspect: number;
  // Which guides GridCell draws: baseline/x-height/ascender/descender, or
  // the em box with its jamo position grid.
  guides: "baseline" | "em";
};

export const SCRIPTS: Script[] = [
  { id: "latin", label: "Latin", aspect: 16 / 9, guides: "baseline" },
  { id: "hangul", label: "Hangul", aspect: 1, guides: "em" },
];

export const DEFAULT_SCRIPT: ScriptId = "latin";

export function scriptById(id: ScriptId): Script {
  return SCRIPTS.find((s) => s.id === id) ?? SCRIPTS[0];
}

export type CharacterSet = {
  id: string;
  label: string;
  chars: string[];
  // Undefined means "latin" — every set that existed before Hangul stays
  // untouched rather than getting a field added to each one.
  script?: ScriptId;
};

export function scriptOf(set: CharacterSet): ScriptId {
  return set.script ?? "latin";
}

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

// Accented Latin letters for French, Spanish, Portuguese, and Scandinavian —
// like CENTRAL_EUROPEAN_EXTRA, not a strict codepage reproduction. Excludes
// anything already covered above: á/é/í/ó/ú/ý (+ uppercase), ä/ö/ü/ß, and
// â/î (+ uppercase) all come from CENTRAL_EUROPEAN_EXTRA already.
const WESTERN_EUROPEAN_EXTRA: string[] = [
  // French
  "à", "À", "è", "È", "ê", "Ê", "ë", "Ë", "ï", "Ï", "ô", "Ô", "û", "Û", "ù", "Ù", "ÿ", "Ÿ", "ç", "Ç",
  // Spanish
  "ñ", "Ñ",
  // Portuguese
  "ã", "Ã", "õ", "Õ",
  // Scandinavian
  "å", "Å", "ø", "Ø", "æ", "Æ",
];

// Modern Russian Cyrillic alphabet (33 letters, upper + lower). Other
// Cyrillic-using languages (Ukrainian, Serbian, Bulgarian, ...) add their own
// extra letters beyond this — out of scope for now, add as its own set if
// that ever comes up rather than folding it in here.
const CYRILLIC: string[] = [
  ..."абвгдежзийклмнопрстуфхцчшщъыьэюя".split(""),
  ..."АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".split(""),
  "ё", "Ё",
];

// Modern (monotonic) Greek: the 24-letter alphabet plus final sigma (ς, used
// only word-finally — a distinct glyph from medial σ) and the tonos/dialytika
// accents monotonic Greek actually uses day to day. Polytonic accents
// (varia, perispomeni, breathing marks) are historical/liturgical use only —
// out of scope, same call as not chasing every historical Latin diacritic.
const GREEK: string[] = [
  ..."αβγδεζηθικλμνξοπρστυφχψω".split(""),
  "ς",
  ..."ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ".split(""),
  "ά", "Ά", "έ", "Έ", "ή", "Ή", "ί", "Ί", "ό", "Ό", "ύ", "Ύ", "ώ", "Ώ",
  "ϊ", "Ϊ", "ϋ", "Ϋ", "ΐ", "ΰ",
];

const NUMBERS: string[] = "0123456789".split("");

// Common punctuation actually needed for handwritten text — not an
// exhaustive symbol set, just what shows up in ordinary sentences. Brackets
// and ellipsis added alongside Symbols below, since both round out
// "ordinary sentence" coverage the same way.
const PUNCTUATION: string[] = [
  ".", ",", "!", "?", ":", ";",
  "'", "‘", "’", "\"", "“", "”",
  "-", "–", "—", "…",
  "(", ")", "[", "]", "{", "}", "‹", "›", "«", "»", "/", "&", "@",
];

// Currency and basic math — the highest-frequency symbols outside of
// letters/figures/punctuation proper. Not an exhaustive symbol catalogue
// (no Glyphs-style Oldstyle/Tabular/Fullwidth variants — those mean drawing
// a whole second alphabet in a different style, out of scope for beta).
const SYMBOLS: string[] = [
  // Currency
  "€", "£", "$", "¥", "¢",
  // Math
  "+", "−", "×", "÷", "=", "<", ">", "%", "‰", "°",
];

// The 24 basic jamo — and that is the whole Korean drawing job. Every
// doubled consonant (ㄲ), consonant cluster (ㄺ) and compound vowel (ㅘ) is
// written as two of these side by side, and all 11.172 syllables are
// composed from them at export/preview time rather than drawn. See
// src/lib/hangul.ts, which owns the list so the grid and the composition
// can't drift apart.
const HANGUL_JAMO: string[] = [...BASIC_CONSONANTS, ...BASIC_VOWELS];

// Add more sets here (e.g. Cyrillic) as their own entry — the grid UI picks
// up any set added to this list automatically.
export const CHARACTER_SETS: CharacterSet[] = [
  { id: "latin-basic", label: "Latin Basic", chars: LATIN_BASIC },
  { id: "central-european", label: "Central European", chars: CENTRAL_EUROPEAN_EXTRA },
  { id: "western-european", label: "Western European", chars: WESTERN_EUROPEAN_EXTRA },
  { id: "cyrillic", label: "Cyrillic", chars: CYRILLIC },
  { id: "greek", label: "Greek", chars: GREEK },
  { id: "numbers", label: "Numbers", chars: NUMBERS },
  { id: "punctuation", label: "Punctuation", chars: PUNCTUATION },
  { id: "symbols", label: "Symbols", chars: SYMBOLS },
  { id: "hangul-jamo", label: "Jamo (24)", chars: HANGUL_JAMO, script: "hangul" },
];

export function setsForScript(script: ScriptId): CharacterSet[] {
  return CHARACTER_SETS.filter((s) => scriptOf(s) === script);
}

// Which scripts the user currently has switched on, in SCRIPTS order. The
// Grid's script tab row keys off this: with one script active there is
// nothing to switch between, so no tab row is drawn at all and a Latin-only
// user never sees that the concept exists.
export function activeScripts(activeSetIds: Set<string>): ScriptId[] {
  return SCRIPTS.map((s) => s.id).filter((id) =>
    CHARACTER_SETS.some((set) => activeSetIds.has(set.id) && scriptOf(set) === id)
  );
}

// Just the 52 basic letters to start with. Four sets on by default meant a new
// font opened onto ~165 empty cells — most of them accents and symbols nobody
// draws first — which reads as a chore rather than an invitation. Every other
// set is one checkbox away in the Character Sets picker (the same picker the
// Grid setup overlay shows before the first stroke), and turning one on later
// never disturbs what's already drawn.
export const DEFAULT_CHARACTER_SET_IDS = ["latin-basic"];
