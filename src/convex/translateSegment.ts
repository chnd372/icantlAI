"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { vly } from "../lib/vly-integrations";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { TRANSLATION_SYSTEM_PROMPT } from "./translationPrompt";

/**
 * Translate a single segment via the Vly AI gateway. Each call is one LLM
 * completion, so it stays well within action time limits; the client runs
 * segments sequentially and progress is persisted after every one.
 */
export const translateSegment = action({
  args: {
    segmentId: v.id("translationSegments"),
    sourceText: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const result = await vly.ai.completion({
      model: args.model,
      messages: [
        { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Translate the following chapter segment into Indonesian. Output only the translated text, nothing else.\n\n---\n${args.sourceText}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 5000,
    });

    if (!result.success) {
      await ctx.runMutation(api.translations.recordSegmentResult, {
        segmentId: args.segmentId,
        translatedText: "",
        status: "error",
        error: result.error ?? "Translation failed",
      });
      throw new Error(result.error ?? "Translation failed");
    }

    const translatedText = result.data?.choices?.[0]?.message?.content ?? "";
    if (!translatedText.trim()) {
      await ctx.runMutation(api.translations.recordSegmentResult, {
        segmentId: args.segmentId,
        translatedText: "",
        status: "error",
        error: "Empty response from the model",
      });
      throw new Error("Empty response from the model");
    }

    await ctx.runMutation(api.translations.recordSegmentResult, {
      segmentId: args.segmentId,
      translatedText,
      status: "done",
    });

    return translatedText;
  },
});
