import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bootstrapStudioAuthRemote, logInStudioAuthRemote, logOutStudioAuthRemote, readStudioAuthSessionFromRemote } from "../runtime/studioAuthRemote";
import { useStudioStore } from "../state/studioStore";

type StudioAuthContextValue = {
  status: "loading" | "setup" | "setup_complete" | "authenticated" | "unauthenticated";
  user: {
    id: string;
    email: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  session: {
    id: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
  } | null;
  error: string | null;
  setupRequired: boolean;
  bootstrapOwner: (input: { email: string; password: string }) => Promise<void>;
  logIn: (input: { email: string; password: string }) => Promise<void>;
  logOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const StudioAuthContext = createContext<StudioAuthContextValue | null>(null);

export function StudioAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "setup" | "setup_complete" | "authenticated" | "unauthenticated">("loading");
  const [user, setUser] = useState<StudioAuthContextValue["user"]>(null);
  const [session, setSession] = useState<StudioAuthContextValue["session"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const clearWorkspace = useStudioStore((state) => state.clearWorkspace);

  async function refreshSession(): Promise<void> {
    setStatus("loading");
    setError(null);
    try {
      const nextSession = await readStudioAuthSessionFromRemote();
      setUser(nextSession.user);
      setSession(nextSession.session);
      setSetupRequired(nextSession.setupRequired);
      setStatus(nextSession.user ? "authenticated" : nextSession.setupRequired ? "setup" : "unauthenticated");
    } catch (nextError) {
      setUser(null);
      setSession(null);
      setSetupRequired(false);
      setStatus("unauthenticated");
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (status !== "setup_complete") {
      return;
    }
    const timer = window.setTimeout(() => {
      setStatus("authenticated");
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status]);

  const value = useMemo<StudioAuthContextValue>(
    () => ({
      status,
      user,
      session,
      error,
      setupRequired,
      async bootstrapOwner(input) {
        setError(null);
        const nextSession = await bootstrapStudioAuthRemote(input);
        setUser(nextSession.user);
        setSession(nextSession.session);
        setSetupRequired(nextSession.setupRequired);
        setStatus(nextSession.user ? "setup_complete" : nextSession.setupRequired ? "setup" : "unauthenticated");
      },
      async logIn(input) {
        setError(null);
        const nextSession = await logInStudioAuthRemote(input);
        setUser(nextSession.user);
        setSession(nextSession.session);
        setSetupRequired(nextSession.setupRequired);
        setStatus(nextSession.user ? "authenticated" : nextSession.setupRequired ? "setup" : "unauthenticated");
      },
      async logOut() {
        setError(null);
        await logOutStudioAuthRemote();
        clearWorkspace();
        setUser(null);
        setSession(null);
        setSetupRequired(false);
        setStatus("unauthenticated");
      },
      refreshSession,
    }),
    [clearWorkspace, error, session, setupRequired, status, user],
  );

  return <StudioAuthContext.Provider value={value}>{children}</StudioAuthContext.Provider>;
}

export function useStudioAuth(): StudioAuthContextValue {
  const context = useContext(StudioAuthContext);
  if (!context) {
    throw new Error("useStudioAuth must be used within StudioAuthProvider.");
  }
  return context;
}
