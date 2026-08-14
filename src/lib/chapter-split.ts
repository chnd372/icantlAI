export interface ChapterSegment {
  index: number;
  sourceText: string;
}

/**
 * Split a chapter into segments of roughly `targetWords` each, keeping
 * paragraphs intact. The client translates these one at a time so each LLM
 * call stays fast and progress can be persisted per segment.
 */
export function splitChapter(
  text: string,
  targetWords = 650,
): ChapterSegment[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

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
  let words = 0;

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      index: segments.length,
      sourceText: current.join("\n\n"),
    });
    current = [];
    words = 0;
  };

  for (const paragraph of paragraphs) {
    const count = paragraph.split(/\s+/).length;
    if (current.length > 0 && words + count > targetWords) flush();
    current.push(paragraph);
    words += count;
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
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
