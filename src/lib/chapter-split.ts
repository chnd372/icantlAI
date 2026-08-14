export interface ChapterSegment {
  index: number;
  sourceText: string;
}

/** Han characters, kana, hangul, and CJK punctuation. */
const CJK_RE =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** Sentence-ending punctuation (kept attached to the sentence when splitting). */
const SENTENCE_BREAK_RE = /(?<=[。！？…；!?;])\s*/;

/**
 * Rough share of CJK characters in the text. CJK scripts have no word
 * boundaries, so they need to be measured and split by character instead.
 */
function isCjkText(text: string): boolean {
  const chars = text.replace(/\s/g, "");
  if (chars.length === 0) return false;
  let cjk = 0;
  for (const ch of chars) {
    if (CJK_RE.test(ch)) cjk++;
  }
  return cjk / chars.length > 0.3;
}

/** Count segmentation units: whitespace-delimited words for Latin text, characters for CJK. */
function countUnits(text: string, cjk: boolean): number {
  if (cjk) return text.replace(/\s/g, "").length;
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Split an over-long paragraph into bounded pieces, preferring sentence
 * boundaries (。！？…；!?;) so each piece stays readable. Falls back to hard
 * cuts when a single "sentence" is itself too long (e.g. no punctuation).
 */
function splitLongParagraph(paragraph: string, target: number, cjk: boolean): string[] {
  const sentences = paragraph.split(SENTENCE_BREAK_RE).filter(Boolean);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  const join = cjk ? "" : " ";

  const pushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const sentence of sentences) {
    const unitCount = countUnits(sentence, cjk);
    if (unitCount > target) {
      // One enormous run of text with no useful breaks — cut it hard.
      pushCurrent();
      let remaining = sentence;
      while (countUnits(remaining, cjk) > target) {
        const cut = cjk
          ? Array.from(remaining).slice(0, target).join("")
          : remaining.split(/\s+/).slice(0, target).join(" ");
        chunks.push(cut);
        remaining = remaining.slice(cut.length);
      }
      if (remaining) chunks.push(remaining);
      continue;
    }

    if (current && countUnits(current + join + sentence, cjk) > target) {
      pushCurrent();
    }
    current = current ? current + join + sentence : sentence;
  }
  pushCurrent();

  return chunks;
}

/**
 * Split a chapter into segments of roughly `targetWords` each, keeping
 * paragraphs intact where possible. CJK chapters (Chinese, Japanese, Korean)
 * are measured in characters instead of words, so a chapter never collapses
 * into one giant segment that would blow past the model's timeout.
 */
export function splitChapter(
  text: string,
  targetWords = 650,
): ChapterSegment[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const cjk = isCjkText(normalized);
  const target = cjk ? Math.round(targetWords * 1.15) : targetWords;

  // Prefer blank-line paragraph breaks; fall back to single newlines for
  // files where every line is a paragraph.
  let paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    paragraphs = normalized
      .split(/\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const segments: ChapterSegment[] = [];
  let current: string[] = [];
  let units = 0;

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      index: segments.length,
      sourceText: current.join("\n\n"),
    });
    current = [];
    units = 0;
  };

  for (const paragraph of paragraphs) {
    const count = countUnits(paragraph, cjk);
    if (count > target) {
      // Paragraph alone exceeds the target — split it at sentence breaks.
      flush();
      for (const piece of splitLongParagraph(paragraph, target, cjk)) {
        segments.push({
          index: segments.length,
          sourceText: piece,
        });
      }
      continue;
    }
    if (current.length > 0 && units + count > target) flush();
    current.push(paragraph);
    units += count;
  }
  flush();

  return segments;
}

/**
 * Best-effort chapter title: the "Chapter N - Title" line, the "Bab N ..."
 * line, or the first short line of the file.
 */
export function extractTitle(text: string): string | null {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const chapter = lines.find((line) =>
    /^(chapter|bab|arc|prologue|epilogue|interlude)\b/i.test(line),
  );
  if (chapter) return chapter;

  const first = lines[0];
  if (first.length <= 90) return first;
  return null;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (isCjkText(trimmed)) return trimmed.replace(/\s/g, "").length;
  return trimmed.split(/\s+/).length;
}
