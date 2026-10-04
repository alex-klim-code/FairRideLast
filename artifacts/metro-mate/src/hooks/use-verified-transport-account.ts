import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { getTransportAccount, type DemoActor } from "@workspace/api-client-react";
import { transportError, verifiedRequestOptions } from "../services/transport-session";

export function useVerifiedTransportAccount() {
  const { user, isLoaded } = useUser();
  const [result, setResult] = useState<{ owner: string; actor: DemoActor | null; error: string } | null>(null);
  useEffect(() => {
    if (!isLoaded || !user) { setResult(null); return; }
    let disposed = false, busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const actor = await getTransportAccount(verifiedRequestOptions);
        if (!disposed) setResult({ owner: user.id, actor, error: "" });
      } catch (error) {
        if (!disposed) setResult({ owner: user.id, actor: null, error: transportError(error) });
      } finally { busy = false; }
    };
    void load();
    const timer = setInterval(load, 3000);
    window.addEventListener("focus", load);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", load); };
  }, [isLoaded, user?.id]);
  // Never show another account's cached role while the next request is pending.
  const current = user && result?.owner === user.id ? result : null;
  return { clerkUser: user, isLoaded, actor: current?.actor ?? null, error: current?.error ?? "", pending: !!user && !current };
}