"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { vly } from "../lib/vly-integrations";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  buildTranslationPrompt,
  type SourceLang,
  type TargetLang,
} from "./translationPrompt";

const TARGET_LABEL: Record<TargetLang, string> = {
  english: "English",
  indonesian: "Indonesian",
};

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

/** OpenAI-compatible chat completions endpoint. */
async function callOpenAICompatible(options: CallOptions): Promise<string> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = /\/chat\/completions$/.test(base)
    ? base
    : `${base}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      temperature: 0.3,
      max_tokens: options.maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `Provider error (${response.status}): ${detail || "request failed"}`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Anthropic Messages API endpoint. */
async function callAnthropic(options: CallOptions): Promise<string> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = /\/v1\/messages$/.test(base) ? base : `${base}/v1/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: 0.3,
      system: options.system,
      messages: [{ role: "user", content: options.user }],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(
      `Provider error (${response.status}): ${detail || "request failed"}`,
    );
  }

  const data = (await response.json()) as {
    content?: { type?: string; text?: string }[];
  };
  return (
    data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("") ?? ""
  );
}

async function complete(
  providerType: "openai" | "anthropic",
  options: CallOptions,
): Promise<string> {
  return providerType === "anthropic"
    ? callAnthropic(options)
    : callOpenAICompatible(options);
}

/**
 * Translate a single segment. Uses the user's custom provider when
 * `providerId` is given, otherwise the built-in Vly gateway with `model`.
 */
export const translateSegment = action({
  args: {
    segmentId: v.id("translationSegments"),
    sourceText: v.string(),
    sourceLang: v.union(v.literal("english"), v.literal("chinese")),
    targetLang: v.union(v.literal("english"), v.literal("indonesian")),
    providerId: v.optional(v.id("aiProviders")),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const system = buildTranslationPrompt(args.sourceLang, args.targetLang);
    const user = `Translate the following chapter segment into ${TARGET_LABEL[args.targetLang]}. Output only the translated text, nothing else.\n\n---\n${args.sourceText}`;

    try {
      let translatedText: string;

      if (args.providerId) {
        const provider = await ctx.runQuery(
          internal.providers.getProviderForAction,
          { providerId: args.providerId, userId },
        );
        if (!provider) {
          throw new Error(
            "AI provider no longer exists — check your provider settings.",
          );
        }
        translatedText = await complete(provider.providerType, {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.modelId,
          system,
          user,
          maxTokens: 5000,
        });
      } else {
        const result = await vly.ai.completion({
          model: args.model ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.3,
          maxTokens: 5000,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Translation failed");
        }
        translatedText = result.data?.choices?.[0]?.message?.content ?? "";
      }

      if (!translatedText.trim()) {
        throw new Error("Empty response from the model");
      }

      await ctx.runMutation(api.translations.recordSegmentResult, {
        segmentId: args.segmentId,
        translatedText,
        status: "done",
      });

      return translatedText;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Translation failed";
      try {
        await ctx.runMutation(api.translations.recordSegmentResult, {
          segmentId: args.segmentId,
          translatedText: "",
          status: "error",
          error: message,
        });
      } catch {
        // Best-effort; the error is rethrown to the client regardless.
      }
      throw new Error(message);
    }
  },
});

/** Send a minimal request to a saved provider to verify the connection. */
export const testProvider = action({
  args: { providerId: v.id("aiProviders") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const provider = await ctx.runQuery(
      internal.providers.getProviderForAction,
      {
        providerId: args.providerId,
        userId,
      },
    );
    if (!provider) throw new Error("Provider not found");

    const reply = await complete(provider.providerType, {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.modelId,
      system: "You are a connectivity test. Reply with exactly: OK",
      user: "Ping",
      maxTokens: 8,
    });

    return reply.trim().slice(0, 80);
  },
});
