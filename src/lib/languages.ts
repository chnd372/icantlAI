export interface Language {
  /** ISO 639-1 style code stored on translations. */
  code: string;
  name: string;
}

/** Languages the raw chapter can be written in. */
export const SOURCE_LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "ko", name: "Korean" },
  { code: "ja", name: "Japanese" },
];

/** Every language the translation can be delivered in. */
export const OUTPUT_LANGUAGES: Language[] = [
  { code: "af", name: "Afrikaans" },
  { code: "ar", name: "Arabic" },
  { code: "hy", name: "Armenian" },
  { code: "az", name: "Azerbaijani" },
  { code: "bn", name: "Bengali" },
  { code: "bg", name: "Bulgarian" },
  { code: "my", name: "Burmese" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "zh-tw", name: "Chinese (Traditional)" },
  { code: "hr", name: "Croatian" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "ka", name: "Georgian" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "gu", name: "Gujarati" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "is", name: "Icelandic" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "kn", name: "Kannada" },
  { code: "kk", name: "Kazakh" },
  { code: "km", name: "Khmer" },
  { code: "ko", name: "Korean" },
  { code: "lo", name: "Lao" },
  { code: "ms", name: "Malay" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "mn", name: "Mongolian" },
  { code: "ne", name: "Nepali" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pa", name: "Punjabi" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sr", name: "Serbian" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Tagalog" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "uz", name: "Uzbek" },
  { code: "vi", name: "Vietnamese" },
];

const ALL_NAMES = new Map(
  [...SOURCE_LANGUAGES, ...OUTPUT_LANGUAGES].map((l) => [l.code, l.name]),
);

/** Codes stored by older versions of the app (full English names). */
const LEGACY_ALIAS: Record<string, string> = {
  english: "en",
  chinese: "zh",
  indonesian: "id",
  korean: "ko",
  japanese: "ja",
};

/** Normalize a stored language value to its ISO code (legacy values included). */
export function resolveLangCode(code: string): string {
  return LEGACY_ALIAS[code] ?? code;
}

/** Human-readable language name for a stored code. */
export function languageName(code: string): string {
  return ALL_NAMES.get(resolveLangCode(code)) ?? code;
}
