"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { languageName } from "../lib/languages";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { complete, listModels, pickChatModel } from "./translateSegment";
import { buildTranslationPrompt } from "./translationPrompt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * One detected text region, normalized to 0..1 fractions of the image so the
 * boxes stay valid whatever resolution the client renders at. `text` is the
 * raw OCR text of that region, in reading order.
 */
interface TextBox {
  text: string;
  x: number; // left / width
  y: number; // top / height
  w: number; // width / width
  h: number; // height / height
}

/** OCR.space language codes (https://ocr.space/ocrapi). */
const OCR_SPACE_LANGUAGES: Record<string, string> = {
  en: "eng",
  zh: "chs",
  ja: "jpn",
  ko: "kor",
};

function ocrSpaceLanguage(code: string): string {
  return OCR_SPACE_LANGUAGES[code] ?? "eng";
}

function base64FromDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:[^,]+,/, "");
}

function mediaTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1] ?? "image/jpeg";
}

function clamp01(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Vision prompt: extract text AND the tight bounding box of each bubble/box
 * so the translation can be typeset back onto the image.
 */
const EXTRACT_PROMPT = `You are an OCR engine for comic, manga, manhua, and manhwa pages.

Look at this page and list EVERY piece of text in it, verbatim and in its original language:
- dialogue inside speech bubbles and thought bubbles
- narration and caption boxes
- written sound effects and signs

Do NOT translate, paraphrase, or summarize anything. Keep the original language and spelling exactly as printed.
Reading order: top to bottom, and right to left for manga where applicable.

Reply with ONLY a JSON object and nothing else, in this exact shape:
{"lines":[{"text":"exact text of one bubble, box, or line","x":0.12,"y":0.08,"w":0.30,"h":0.06}]}

- One entry per bubble/box/line, in reading order.
- x = distance from the left edge / image width, y = distance from the top edge / image height.
- w = box width / image width, h = box height / image height. Values are 0..1 fractions.
- Each box must tightly enclose just that one text.
- If the page has no readable text, reply with exactly: NO TEXT`;

/** Clean OCR garbage (misrecognized chars, spacing, punctuation) before translating. */
const CLEAN_PROMPT = `You are cleaning OCR output extracted from a comic, manga, manhua, or manhwa page.

Fix the OCR text below:
- Correct misrecognized characters, garbled words, and missing or doubled letters
- Restore punctuation, capitalization, and proper spacing
- Keep the ORIGINAL LANGUAGE — do NOT translate anything
- Keep each bubble/box/line on its own line, in the same order as given
- Drop lines that are pure noise or illegible
- Do not add, summarize, or invent text

Output only the cleaned text.`;

interface ProviderForAction {
  providerType: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  modelId: string | null;
  models: string[];
}

async function fetchProvider(
  ctx: any,
  providerId: string,
  userId: string,
): Promise<ProviderForAction> {
  const provider = (await ctx.runQuery(
    internal.providers.getProviderForAction,
    { providerId, userId },
  )) as ProviderForAction | null;
  if (!provider) {
    throw new Error(
      "AI provider no longer exists — check your provider settings.",
    );
  }
  return provider;
}

/** Use the provider's fixed model, or auto-pick a chat-capable one. */
async function resolveProviderModel(provider: ProviderForAction): Promise<string> {
  if (provider.modelId) return provider.modelId;
  const models = await listModels(
    provider.providerType,
    provider.baseUrl,
    provider.apiKey,
  );
  const model = pickChatModel(models);
  if (!model) {
    throw new Error(
      "No models found at this base URL — set a model ID for this provider.",
    );
  }
  return model;
}

/** Extract text + boxes via the ocr.space API (free tier). */
async function extractViaOcrSpace(
  apiKey: string,
  imageData: string,
  sourceLang: string,
  imageWidth: number,
  imageHeight: number,
): Promise<{ text: string; boxes: TextBox[] }> {

  const form = new URLSearchParams();
  form.set("apikey", apiKey);
  form.set("language", ocrSpaceLanguage(sourceLang));
  // OCR.space expects the FULL data URI (with the data:image/...;base64,
  // prefix) — sending the raw base64 alone triggers E501 "Invalid base64
  // Data URI".
  form.set("base64Image", imageData);
  // Overlay required: the response then includes word coordinates.
  form.set("isOverlayRequired", "true");
  form.set("scale", "true");
  form.set("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `OCR.space error (${response.status}): ${detail || "request failed"}`,
    );
  }

  const data = (await response.json()) as {
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
    ParsedResults?: {
      ParsedText?: string;
      TextOverlay?: {
        Lines?: {
          Words?: {
            WordText?: string;
            Left?: number;
            Top?: number;
            Width?: number;
            Height?: number;
          }[];
        }[];
      };
    }[];
  };

  if (data.IsErroredOnProcessing) {
    const message = Array.isArray(data.ErrorMessage)
      ? data.ErrorMessage.join(" ")
      : data.ErrorMessage ?? "Unknown OCR error";
    throw new Error(`OCR.space: ${message}`);
  }

  const parsed = data.ParsedResults?.[0];
  const text = (parsed?.ParsedText ?? "").trim();
  if (!text) {
    throw new Error(
      "No text detected on this page — it may be art-only or too low-res.",
    );
  }

  const boxes: TextBox[] = [];
  for (const line of parsed?.TextOverlay?.Lines ?? []) {
    const words = (line.Words ?? []).filter(
      (word) =>
        typeof word.Left === "number" &&
        typeof word.Top === "number" &&
        typeof word.Width === "number" &&
        typeof word.Height === "number",
    );
    if (words.length === 0) continue;
    const left = Math.min(...words.map((w) => w.Left as number));
    const top = Math.min(...words.map((w) => w.Top as number));
    const right = Math.max(
      ...words.map((w) => (w.Left as number) + (w.Width as number)),
    );
    const bottom = Math.max(
      ...words.map((w) => (w.Top as number) + (w.Height as number)),
    );
    boxes.push({
      text: words.map((w) => w.WordText ?? "").join(" ").trim(),
      x: clamp01(left / imageWidth),
      y: clamp01(top / imageHeight),
      w: clamp01((right - left) / imageWidth),
      h: clamp01((bottom - top) / imageHeight),
    });
  }

  return { text, boxes };
}

/** Extract text + boxes with a vision-capable model on the custom provider. */
async function extractViaVision(
  provider: ProviderForAction,
  modelId: string,
  imageData: string,
): Promise<{ text: string; boxes: TextBox[] }> {
  const userContent: unknown[] =
    provider.providerType === "anthropic"
      ? [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaTypeFromDataUrl(imageData),
              data: base64FromDataUrl(imageData),
            },
          },
          { type: "text", text: EXTRACT_PROMPT },
        ]
      : [
          { type: "text", text: EXTRACT_PROMPT },
          { type: "image_url", image_url: { url: imageData } },
        ];

  const extracted = await complete(provider.providerType, {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: modelId,
    system:
      "You are a precise OCR engine. Extract text exactly as printed; never translate or alter it.",
    user: userContent,
    maxTokens: 3000,
  });

  const raw = extracted.trim();
  if (!raw || raw.toUpperCase() === "NO TEXT") {
    throw new Error(
      "No text detected on this page — it may be art-only or the model could not read it.",
    );
  }

  // The model should reply with JSON; tolerate fenced code blocks and
  // surrounding prose by extracting the first {...} block.
  const jsonText = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  const first = jsonText.indexOf("{");
  const last = jsonText.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      const parsed = JSON.parse(jsonText.slice(first, last + 1)) as {
        lines?: { text?: string; x?: number; y?: number; w?: number; h?: number }[];
      };
      const boxes = (parsed.lines ?? [])
        .filter(
          (l): l is { text: string; x?: number; y?: number; w?: number; h?: number } =>
            typeof l.text === "string" && l.text.trim().length > 0,
        )
        .map((l) => ({
          text: l.text.trim(),
          x: clamp01(l.x),
          y: clamp01(l.y),
          w: clamp01(l.w),
          h: clamp01(l.h),
        }));
      if (boxes.length > 0) {
        return { text: boxes.map((b) => b.text).join("\n"), boxes };
      }
    } catch {
      // Not valid JSON — fall back to plain text below.
    }
  }

  return { text: raw, boxes: [] };
}

/** Clean the raw OCR text with the same provider (never translates). */
async function cleanOcrText(
  provider: ProviderForAction,
  modelId: string,
  text: string,
): Promise<string> {
  const cleaned = await complete(provider.providerType, {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: modelId,
    system:
      "You are an OCR post-processor. Clean the text; never translate or rewrite its meaning.",
    user: `${CLEAN_PROMPT}\n\n---\n${text}`,
    maxTokens: 4000,
  });
  return cleaned.trim() || text; // fall back to the raw text if empty
}

// ---------------------------------------------------------------------------
// Action 1: OCR (saved first, so a later failure never loses it)
// ---------------------------------------------------------------------------

/**
 * Extract the raw text (and each text region's box, in reading order) from a
 * comic page. The client saves this result immediately, then runs the
 * clean + translate stage separately.
 */
export const ocrComicPage = action({
  args: {
    imageData: v.string(), // data URL of the (client-downscaled) page
    imageWidth: v.number(),
    imageHeight: v.number(),
    ocrMethod: v.union(v.literal("ocrspace"), v.literal("vision")),
    sourceLang: v.string(),
    providerId: v.optional(v.id("aiProviders")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ocrText: string;
    boxes: { text: string; x: number; y: number; w: number; h: number }[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    if (args.ocrMethod === "ocrspace") {
      // Prefer the key stored per user in Settings; fall back to a
      // deployment-level OCR_SPACE_API_KEY env var if set.
      const storedKey = await ctx.runQuery(
        internal.settings.getOcrSpaceApiKeyForAction,
        { userId },
      );
      const apiKey = storedKey ?? process.env.OCR_SPACE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OCR.space needs an API key — add it in Settings → OCR.space (free key at ocr.space), or set OCR_SPACE_API_KEY as a Convex environment variable.",
        );
      }
      const extracted = await extractViaOcrSpace(
        apiKey,
        args.imageData,
        args.sourceLang,
        args.imageWidth,
        args.imageHeight,
      );
      return { ocrText: extracted.text, boxes: extracted.boxes };
    }

    if (!args.providerId) {
      throw new Error("Pick an AI provider — vision OCR runs through it.");
    }
    const provider = await fetchProvider(ctx, args.providerId, userId);
    const extracted = await extractViaVision(
      provider,
      await resolveProviderModel(provider),
      args.imageData,
    );
    return { ocrText: extracted.text, boxes: extracted.boxes };
  },
});

// ---------------------------------------------------------------------------
// Action 2: clean + translate + pair boxes (for typesetting on the raw image)
// ---------------------------------------------------------------------------

/**
 * Clean the saved OCR text, translate it with the same standard pipeline as
 * novel chapters, and pair each translated line with its raw OCR box (1:1,
 * reading order) so the client can implant the result onto the image.
 */
export const translateComicPage = action({
  args: {
    ocrText: v.string(),
    boxes: v.array(
      v.object({
        text: v.string(),
        x: v.number(),
        y: v.number(),
        w: v.number(),
        h: v.number(),
      }),
    ),
    sourceLang: v.string(),
    targetLang: v.string(),
    providerId: v.id("aiProviders"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    cleanedText: string;
    translatedText: string;
    overlays: { x: number; y: number; w: number; h: number; text: string }[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const provider = await fetchProvider(ctx, args.providerId, userId);
    const modelId = await resolveProviderModel(provider);

    // 1) Clean the OCR output so the translation starts from readable text.
    const cleanedText = await cleanOcrText(provider, modelId, args.ocrText);

    // 2) Translate the cleaned text.
    const customPrompt = await ctx.runQuery(
      internal.settings.getCustomPromptForAction,
      { userId },
    );
    const system = buildTranslationPrompt(
      args.sourceLang,
      args.targetLang,
      customPrompt ?? undefined,
    );
    const user = `The text below was extracted from a comic/manga/manhwa page. Translate it into ${languageName(
      args.targetLang,
    )}, keeping every dialogue line, caption, and sound effect on its own line, in reading order. Keep character names, titles, and honorifics untranslated. Output only the translated text.\n\n---\n${cleanedText}`;

    const translatedText = (
      await complete(provider.providerType, {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: modelId,
        system,
        user,
        maxTokens: 5000,
      })
    ).trim();

    if (!translatedText) {
      throw new Error("Empty response from the model");
    }

    // 3) Pair each raw OCR box with its translated line. Boxes without a
    // translated line are dropped so the overlay never draws empty panels.
    const translatedLines = translatedText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const overlays = args.boxes
      .map((box, i) => ({
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        text: translatedLines[i] ?? "",
      }))
      .filter((o) => o.text);

    return { cleanedText, translatedText, overlays };
  },
});
