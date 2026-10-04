import { createDemoTransportSession, deleteDemoTransportSession, getDemoTransportSession, type DemoActor } from "@workspace/api-client-react";
export type DemoRole = DemoActor["role"];
export const demoRequestOptions = { headers: { "X-FairRide-Demo": "1", "X-FairRide-Mode": "demo" }, credentials: "same-origin" as const };
export const verifiedRequestOptions = { headers: { "X-FairRide-Request": "1", "X-FairRide-Mode": "verified" }, credentials: "same-origin" as const };
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}
export const selectDemoTransportRole = (role: DemoRole) =>
  serialize(() => createDemoTransportSession({ role }, demoRequestOptions));
export const clearDemoTransportRole = () =>
  serialize(() => deleteDemoTransportSession(demoRequestOptions));
export const ensureDemoTransportRole = (role: DemoRole) => serialize(async () => {
  try {
    const actor = await getDemoTransportSession(demoRequestOptions);
    if (actor.role === role) return actor;
  } catch (error) {
    if ((error as { status?: number }).status !== 401) throw error;
  }
  // Never recreate a privileged role from localStorage or a page route.
  throw new Error("Demo session changed. Select the demo view again.");
});
export function transportError(error: unknown) {
  const value = error as { data?: { error?: unknown }; message?: string };
  return typeof value?.data?.error === "string" ? value.data.error : value instanceof Error && value.message.startsWith("Demo session") ? value.message :
    "Transport service unavailable. No successful operation was confirmed. Refresh to check server state.";
}