import type { DemoActor, TransportState } from "./transport-domain";

export function workspaceFor(state: TransportState, actor: DemoActor) {
  const own = state.checkIns.filter(j => j.userId === actor.id);
  const visibleInspections = actor.role === "ADMIN" ? state.inspections :
    actor.role === "CONDUCTOR" ? state.inspections.filter(i => i.status === "ACTIVE" || i.conductorId === actor.id) :
      state.inspections.filter(i => i.status === "ACTIVE");
  const inspectedVehicles = new Set(visibleInspections.filter(i => i.status === "ACTIVE" &&
    (actor.role === "ADMIN" || i.conductorId === actor.id)).map(i => i.vehicleId));
  return {
    actor, vehicles: state.vehicles, updatedAt: state.updatedAt,
    // Staff get anonymous active boarding references, never a passenger identity,
    // request replay key, completed journey, or unrelated vehicle's boarding list.
    checkIns: actor.role === "USER" ? own : state.checkIns.filter(j =>
      j.status === "ACTIVE" && inspectedVehicles.has(j.vehicleId)).map(j => ({ ...j, userId: "", requestId: "" })),
    inspections: visibleInspections.map(i => ({
      ...i, requestId: "", conductorId: actor.role === "USER" ? "" :
        actor.role === "ADMIN" || i.conductorId === actor.id ? i.conductorId : `inspector:${i.id}`,
      numberOfPassengersAlreadyCheckedIn: actor.role === "USER" ? 0 : i.numberOfPassengersAlreadyCheckedIn,
      numberOfBlockedCheckInAttempts: actor.role === "USER" ? 0 : i.numberOfBlockedCheckInAttempts,
    })),
  };
}