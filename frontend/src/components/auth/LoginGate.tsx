import { type ReactNode, useEffect, useState } from "react";
import { Logo } from "@/components/layout/Logo";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { useAuthHeader, whenAuthRestored } from "@/lib/auth";

type GateState = "checking" | "required" | "authenticated";

/**
 * Railway/mobile-safe login gate.
 *
 * Older versions tried a deliberately-wrong Basic Authorization header on
 * startup to detect whether nginx authentication was enabled. Android Chrome
 * can convert nginx's 401 + WWW-Authenticate response into its native Basic
 * Auth dialog. Because that probe header is explicitly wrong, entering the
 * correct credentials into the browser dialog still cannot satisfy the probe,
 * producing an endless login-popup loop.
 *
 * This fork is a protected personal deployment, so there is no need to probe.
 * We first restore any remembered Aurum credential; if none exists we render
 * Aurum's own login screen without touching /api at all. The first protected
 * request is therefore the user's actual credential check.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const authHeader = useAuthHeader();
  const [state, setState] = useState<GateState>(authHeader ? "authenticated" : "checking");

  useEffect(() => {
    if (authHeader) {
      setState("authenticated");
      return;
    }

    let cancelled = false;
    void whenAuthRestored().then(() => {
      if (!cancelled) setState("required");
    });

    return () => {
      cancelled = true;
    };
  }, [authHeader]);

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <Logo size={40} className="animate-pulse" />
      </div>
    );
  }

  if (state === "required" && !authHeader) {
    return <LoginScreen />;
  }

  return <>{children}</>;
}
