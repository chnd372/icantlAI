import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internalQuery, mutation, query } from "./_generated/server";

/** Save the translator's own instructions, injected into every translation run. */
export const saveCustomPrompt = mutation({
  args: { customPrompt: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const trimmed = args.customPrompt.trim();
    await ctx.db.patch(userId, {
      customPrompt: trimmed || undefined,
    });
    return trimmed;
  },
});

/** Fetch the instructions inside actions. Internal only — not client-callable. */
export const getCustomPromptForAction = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.customPrompt ?? null;
  },
});

// ---------------------------------------------------------------------------
// OCR.space API key (comic pages)
// ---------------------------------------------------------------------------

/** Save (or remove, when empty) the user's OCR.space API key. */
export const saveOcrSpaceApiKey = mutation({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const key = args.apiKey.trim();
    const existing = await ctx.db
      .query("ocrSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!key) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { apiKey: key, updatedAt: now });
    } else {
      await ctx.db.insert("ocrSettings", {
        userId,
        apiKey: key,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/** Fetch the key inside actions. Internal only — never returned to the client. */
export const getOcrSpaceApiKeyForAction = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("ocrSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    return doc?.apiKey ?? null;
  },
});

/** Whether the user has a key stored (only the last 4 chars for display). */
export const getOcrSpaceKeyStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { hasKey: false, keySuffix: null };
    const doc = await ctx.db
      .query("ocrSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!doc?.apiKey) return { hasKey: false, keySuffix: null };
    return { hasKey: true, keySuffix: doc.apiKey.slice(-4) };
  },
});
