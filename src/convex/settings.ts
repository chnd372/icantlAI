import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internalQuery, mutation } from "./_generated/server";

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
