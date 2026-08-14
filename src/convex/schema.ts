import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove
      customPrompt: v.optional(v.string()), // translator's own instructions injected into every translation prompt

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // A translated chapter. The source is stored once here; the translated
    // result is assembled from translationSegments as they complete.
    translations: defineTable({
      userId: v.id("users"),
      fileName: v.string(), // original uploaded file name
      title: v.optional(v.string()), // first meaningful line (usually the chapter title)
      novelName: v.optional(v.string()), // series or novel this chapter belongs to
      sourceText: v.string(),
      model: v.string(),
      providerId: v.optional(v.id("aiProviders")), // custom AI provider used, if any
      sourceLang: v.string(), // ISO code of the raw chapter's language
      targetLang: v.string(), // ISO code of the delivered translation's language
      status: v.union(
        v.literal("draft"),
        v.literal("translating"),
        v.literal("done"),
        v.literal("error"),
      ),
      error: v.optional(v.string()),
      segmentCount: v.number(),
      completedSegments: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]),

    // Custom AI providers configured by the user (OpenAI- or Anthropic-
    // compatible endpoints). The API key lives only in the database and is
    // read server-side by actions; it is never returned to the client.
    aiProviders: defineTable({
      userId: v.id("users"),
      name: v.string(),
      providerType: v.union(v.literal("openai"), v.literal("anthropic")),
      baseUrl: v.string(),
      apiKey: v.string(),
      modelId: v.optional(v.string()), // optional — when blank, the action picks a model from the provider's list
      models: v.optional(v.array(v.string())), // last-fetched list of models at this base URL
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId", "createdAt"]),

    // One piece of the chapter being translated. The client translates
    // segments sequentially; each finished segment is persisted here so
    // progress survives reloads and partial work is never lost.
    translationSegments: defineTable({
      translationId: v.id("translations"),
      index: v.number(),
      sourceText: v.string(),
      translatedText: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("done"),
        v.literal("error"),
      ),
    }).index("by_translation", ["translationId", "index"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
