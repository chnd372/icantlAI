import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";

import { passwordAuth } from "./auth/password";


export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordAuth, Anonymous],
});