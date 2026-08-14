import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import { ArrowRight, Loader2, Lock, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("flow", mode);
      await signIn("password", formData);
      // On success the auth state flips and the effect above navigates.
    } catch (error) {
      console.error("Sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : mode === "signUp"
            ? "Could not create the account. Please try again."
            : "Could not sign in. Please check your details and try again.",
      );
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      setIsLoading(false);
    }
  };

  const switchMode = (next: "signIn" | "signUp") => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="page-surface min-h-screen flex flex-col">
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="flex items-center justify-center h-full flex-col">
          <Card className="w-full max-w-[380px] pb-0 border shadow-md">
            <CardHeader className="text-center">
              <div className="flex justify-center">
                <img
                  src={logo}
                  alt="Lock Icon"
                  width={64}
                  height={64}
                  className="rounded-lg mb-4 mt-4 cursor-pointer"
                  onClick={() => navigate("/")}
                />
              </div>
              <CardTitle className="text-xl">
                {mode === "signUp" ? "Create your account" : "Welcome back"}
              </CardTitle>
              <CardDescription>
                {mode === "signUp"
                  ? "Sign up with an email or username and a password"
                  : "Sign in with your email or username and password"}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent>
                {mode === "signUp" && (
                  <div className="mb-3">
                    <Label htmlFor="name" className="text-xs text-muted-foreground">
                      Name (optional)
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="Your name"
                      autoComplete="name"
                      className="mt-1.5"
                      disabled={isLoading}
                    />
                  </div>
                )}
                <div className="mb-3">
                  <Label
                    htmlFor="identifier"
                    className="text-xs text-muted-foreground"
                  >
                    Email or username
                  </Label>
                  <div className="relative mt-1.5">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="identifier"
                      name="email"
                      placeholder={mode === "signUp" ? "you@example.com or yourname" : "you@example.com or yourname"}
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label
                    htmlFor="password"
                    className="text-xs text-muted-foreground"
                  >
                    Password
                  </Label>
                  <div className="relative mt-1.5">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="At least 8 characters"
                      className="pl-9"
                      disabled={isLoading}
                      required
                      minLength={8}
                    />
                  </div>
                </div>
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

                <Button
                  type="submit"
                  className="w-full mt-4"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  {mode === "signUp" ? "Create account" : "Sign in"}
                </Button>

                <div className="mt-4">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Or
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full mt-4"
                    onClick={handleGuestLogin}
                    disabled={isLoading}
                  >
                    <UserX className="mr-2 h-4 w-4" />
                    Continue as Guest
                  </Button>
                </div>
              </CardContent>
            </form>
            <CardFooter className="flex-col gap-1 pb-6">
              <p className="text-sm text-muted-foreground">
                {mode === "signUp" ? (
                  <>
                    Already have an account?{" "}
                    <Button
                      type="button"
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => switchMode("signIn")}
                      disabled={isLoading}
                    >
                      Sign in
                    </Button>
                  </>
                ) : (
                  <>
                    New to Ican Translator AI?{" "}
                    <Button
                      type="button"
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => switchMode("signUp")}
                      disabled={isLoading}
                    >
                      Create an account
                    </Button>
                  </>
                )}
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
