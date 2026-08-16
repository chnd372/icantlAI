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

const EXTRACT_PROMPT = `You are an OCR engine for comic, manga, manhua, and manhwa pages.

Extract EVERY piece of text from this page, verbatim and in its original language:
- dialogue inside speech bubbles and thought bubbles
- narration and caption boxes
- written sound effects and signs

Do NOT translate, paraphrase, or summarize anything. Keep the original language and spelling exactly as printed.
Preserve the reading order (top to bottom; right to left for manga where applicable) and separate each bubble/box/line with a newline.
If the page has no readable text, reply with exactly: NO TEXT`;

interface ProviderForAction {
  providerType: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  modelId: string | null;
  models: string[];
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

/** Extract text via the ocr.space API (free tier, key from server env). */
async function extractViaOcrSpace(
  imageData: string,
  sourceLang: string,
): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OCR.space needs an API key — add OCR_SPACE_API_KEY in the Keys tab (free key at ocr.space).",
    );
  }

  const form = new URLSearchParams();
  form.set("apikey", apiKey);
  form.set("language", ocrSpaceLanguage(sourceLang));
  form.set("base64Image", base64FromDataUrl(imageData));
  form.set("isOverlayRequired", "false");
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
    ParsedResults?: { ParsedText?: string }[];
  };

  if (data.IsErroredOnProcessing) {
    const message = Array.isArray(data.ErrorMessage)
      ? data.ErrorMessage.join(" ")
      : data.ErrorMessage ?? "Unknown OCR error";
    throw new Error(`OCR.space: ${message}`);
  }

  const text = (data.ParsedResults?.[0]?.ParsedText ?? "").trim();
  if (!text) {
    throw new Error(
      "No text detected on this page — it may be art-only or too low-res.",
    );
  }
  return text;
}

/** Extract text with a vision-capable model on the user's custom provider. */
async function extractViaVision(
  provider: ProviderForAction,
  modelId: string,
  imageData: string,
): Promise<string> {
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

  const trimmed = extracted.trim();
  if (!trimmed || trimmed.toUpperCase() === "NO TEXT") {
    throw new Error(
      "No text detected on this page — it may be art-only or the model could not read it.",
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * One comic/manhua/manhwa page: extract the text (OCR.space or a vision LLM
 * on the user's own provider), then translate it with the same standard
 * pipeline as novel chapters (custom instructions included).
 */
export const translateComicPage = action({
  args: {
    imageData: v.string(), // data URL of the (client-downscaled) page
    ocrMethod: v.union(v.literal("ocrspace"), v.literal("vision")),
    sourceLang: v.string(),
    targetLang: v.string(),
    providerId: v.id("aiProviders"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ocrText: string; translatedText: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const provider = (await ctx.runQuery(
      internal.providers.getProviderForAction,
      { providerId: args.providerId, userId },
    )) as ProviderForAction | null;
    if (!provider) {
      throw new Error(
        "AI provider no longer exists — check your provider settings.",
      );
    }

    // 1) Extract the raw text from the page.
    const ocrText: string =
      args.ocrMethod === "ocrspace"
        ? await extractViaOcrSpace(args.imageData, args.sourceLang)
        : await extractViaVision(
            provider,
            await resolveProviderModel(provider),
            args.imageData,
          );

    // 2) Translate it with the same standard pipeline as chapters.
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
    )}, keeping every dialogue line, caption, and sound effect on its own line, in reading order. Keep character names, titles, and honorifics untranslated. Output only the translated text.\n\n---\n${ocrText}`;

    const modelId = await resolveProviderModel(provider);
    const translatedText = await complete(provider.providerType, {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: modelId,
      system,
      user,
      maxTokens: 5000,
    });

    if (!translatedText.trim()) {
      throw new Error("Empty response from the model");
    }

    return { ocrText, translatedText: translatedText.trim() };
  },
});
