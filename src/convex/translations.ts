import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Recent chapters for the signed-in user, newest first. */
export const listTranslations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const translations = await ctx.db
      .query("translations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    return translations.map((t) => ({
      _id: t._id,
      fileName: t.fileName,
      title: t.title ?? null,
      novelName: t.novelName ?? null,
      sourcePreview: t.sourceText.slice(0, 220),
      model: t.model,
      sourceLang: t.sourceLang ?? "en",
      targetLang: t.targetLang ?? "id",
      status: t.status,
      error: t.error ?? null,
      segmentCount: t.segmentCount,
      completedSegments: t.completedSegments,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  },
});

/** A single chapter with all of its segments, for the signed-in owner. */
export const getTranslation = query({
  args: { translationId: v.id("translations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const translation = await ctx.db.get(args.translationId);
    if (!translation || translation.userId !== userId) return null;

    const segments = await ctx.db
      .query("translationSegments")
      .withIndex("by_translation", (q) => q.eq("translationId", translation._id))
      .order("asc")
      .collect();

    return {
      translation: {
        _id: translation._id,
        fileName: translation.fileName,
        title: translation.title ?? null,
        novelName: translation.novelName ?? null,
        sourceText: translation.sourceText,
        model: translation.model,
        providerId: translation.providerId ?? null,
        sourceLang: translation.sourceLang ?? "en",
        targetLang: translation.targetLang ?? "id",
        status: translation.status,
        error: translation.error ?? null,
        segmentCount: translation.segmentCount,
        completedSegments: translation.completedSegments,
        createdAt: translation.createdAt,
        updatedAt: translation.updatedAt,
      },
      segments: segments.map((s) => ({
        _id: s._id,
        index: s.index,
        sourceText: s.sourceText,
        translatedText: s.translatedText ?? null,
        status: s.status,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a chapter and its untranslated segments. */
export const createTranslation = mutation({
  args: {
    fileName: v.string(),
    title: v.optional(v.string()),
    novelName: v.optional(v.string()),
    sourceText: v.string(),
    model: v.string(),
    providerId: v.optional(v.id("aiProviders")),
    sourceLang: v.string(),
    targetLang: v.string(),
    segments: v.array(
      v.object({
        index: v.number(),
        sourceText: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    if (args.segments.length === 0) throw new Error("Chapter is empty");

    const now = Date.now();
    const translationId = await ctx.db.insert("translations", {
      userId,
      fileName: args.fileName,
      title: args.title,
      novelName: args.novelName,
      sourceText: args.sourceText,
      model: args.model,
      providerId: args.providerId,
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      status: "draft",
      segmentCount: args.segments.length,
      completedSegments: 0,
      createdAt: now,
      updatedAt: now,
    });

    for (const segment of args.segments) {
      await ctx.db.insert("translationSegments", {
        translationId,
        index: segment.index,
        sourceText: segment.sourceText,
        status: "pending",
      });
    }

    return translationId;
  },
});

/** Store the result of one finished segment (called from the action). */
export const recordSegmentResult = mutation({
  args: {
    segmentId: v.id("translationSegments"),
    translatedText: v.string(),
    status: v.union(v.literal("done"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const segment = await ctx.db.get(args.segmentId);
    if (!segment) return;

    await ctx.db.patch(args.segmentId, {
      translatedText: args.translatedText,
      status: args.status,
    });

    const translation = await ctx.db.get(segment.translationId);
    if (!translation) return;

    const completedSegments =
      args.status === "done"
        ? translation.completedSegments + 1
        : translation.completedSegments;

    const status =
      args.status === "error"
        ? "error"
        : completedSegments >= translation.segmentCount
          ? "done"
          : "translating";

    await ctx.db.patch(segment.translationId, {
      completedSegments,
      status,
      error: args.status === "error" ? (args.error ?? "Segment failed") : undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Add a chapter straight to the catalog without running the translator — for
 * back-catalog work or chapters translated outside this app.
 */
export const importChapter = mutation({
  args: {
    fileName: v.string(),
    title: v.optional(v.string()),
    novelName: v.optional(v.string()),
    sourceText: v.optional(v.string()),
    translatedText: v.string(),
    model: v.string(),
    sourceLang: v.optional(v.string()),
    targetLang: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    if (!args.translatedText.trim()) throw new Error("Nothing to add");

    const now = Date.now();
    const translationId = await ctx.db.insert("translations", {
      userId,
      fileName: args.fileName,
      title: args.title,
      novelName: args.novelName,
      sourceText: args.sourceText ?? "",
      model: args.model,
      sourceLang: args.sourceLang ?? "en",
      targetLang: args.targetLang ?? "id",
      status: "done",
      segmentCount: 1,
      completedSegments: 1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("translationSegments", {
      translationId,
      index: 0,
      sourceText: args.sourceText ?? "",
      translatedText: args.translatedText,
      status: "done",
    });

    return translationId;
  },
});

/** Mark a chapter as translating (when the run starts). */
export const startTranslation = mutation({
  args: { translationId: v.id("translations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const translation = await ctx.db.get(args.translationId);
    if (!translation || translation.userId !== userId) throw new Error("Not found");

    await ctx.db.patch(args.translationId, {
      status: "translating",
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Delete a chapter and all of its segments. */
export const deleteTranslation = mutation({
  args: { translationId: v.id("translations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const translation = await ctx.db.get(args.translationId);
    if (!translation || translation.userId !== userId) throw new Error("Not found");

    const segments = await ctx.db
      .query("translationSegments")
      .withIndex("by_translation", (q) => q.eq("translationId", translation._id))
      .collect();

    for (const segment of segments) {
      await ctx.db.delete(segment._id);
    }
    await ctx.db.delete(translation._id);
  },
});
