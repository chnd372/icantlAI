import { Password } from "@convex-dev/auth/providers/Password";
import type { PasswordConfig } from "@convex-dev/auth/providers/Password";

/**
 * Email/username + password authentication.
 *
 * One identifier field serves both cases:
 *  - contains "@" → treated as an email (stored lowercased)
 *  - otherwise    → treated as a username
 *
 * The Password provider keys the auth account by the `email` returned from
 * `profile`, so username accounts simply use the username as their account id
 * (stored lowercased, plus a `username` field on the user for display and
 * future features). Duplicate usernames and emails are rejected by the auth
 * layer automatically, because creating a second account with the same id
 * throws.
 */
type ProfileFn = NonNullable<PasswordConfig<any>["profile"]>;

export const passwordAuth = Password({
  id: "password",
  profile: ((params: Record<string, import("convex/values").Value | undefined>) => {
    const raw = typeof params.email === "string" ? params.email.trim() : "";
    if (!raw) {
      throw new Error("Email or username is required.");
    }

    const isEmail = raw.includes("@");
    const identifier = raw.toLowerCase();

    // Sign up: give the account a sensible display name. The username path
    // also records the handle on the user document.
    if (params.flow === "signUp") {
      const name =
        typeof params.name === "string" && params.name.trim()
          ? params.name.trim()
          : undefined;
      if (!isEmail) {
        return {
          name: name ?? raw,
          username: identifier,
          email: identifier,
        };
      }
      return { name, email: identifier };
    }

    // Sign in (and any other flow): the account id is the identifier itself.
    return { email: identifier };
  }) as unknown as ProfileFn,
});
