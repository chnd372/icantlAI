import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internalQuery, mutation, query } from "./_generated/server";

/** The user's custom AI providers (keys are never included in the result). */
export const listProviders = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const providers = await ctx.db
      .query("aiProviders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return providers.map((p) => ({
      _id: p._id,
      name: p.name,
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      modelId: p.modelId,
      keySuffix: p.apiKey.slice(-4),
      createdAt: p.createdAt,
    }));
  },
});

/**
 * Fetch a provider with its API key for use inside actions. Internal only —
 * not callable from the client, so the key never leaves the server.
 */
export const getProviderForAction = internalQuery({
  args: {
    providerId: v.id("aiProviders"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider || provider.userId !== args.userId) return null;
    return {
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelId: provider.modelId,
    };
  },
});

/**
 * Create or update a provider. When updating with an empty API key the
 * existing key is kept, so re-saving a provider does not require re-pasting
 * the secret.
 */
export const saveProvider = mutation({
  args: {
    providerId: v.optional(v.id("aiProviders")),
    name: v.string(),
    providerType: v.union(v.literal("openai"), v.literal("anthropic")),
    baseUrl: v.string(),
    apiKey: v.string(),
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const name = args.name.trim();
    const baseUrl = args.baseUrl.trim().replace(/\/+$/, "");
    const modelId = args.modelId.trim();

    if (!name || !baseUrl || !modelId) {
      throw new Error("Name, base URL, and model are required.");
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new Error("Base URL must start with http:// or https://");
    }

    const now = Date.now();

    if (args.providerId) {
      const existing = await ctx.db.get(args.providerId);
      if (!existing || existing.userId !== userId) throw new Error("Not found");
      await ctx.db.patch(args.providerId, {
        name,
        providerType: args.providerType,
        baseUrl,
        modelId,
        apiKey: args.apiKey.trim() || existing.apiKey,
        updatedAt: now,
      });
      return args.providerId;
    }

    if (!args.apiKey.trim()) throw new Error("API key is required.");
    return await ctx.db.insert("aiProviders", {
      userId,
      name,
      providerType: args.providerType,
      baseUrl,
      apiKey: args.apiKey.trim(),
      modelId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteProvider = mutation({
  args: { providerId: v.id("aiProviders") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const provider = await ctx.db.get(args.providerId);
    if (!provider || provider.userId !== userId) throw new Error("Not found");

    await ctx.db.delete(args.providerId);
  },
});
