import type { TransitStep } from '@workspace/api-client-react';

export type WalkingGroup = {
  kind: 'access' | 'transfer' | 'egress' | 'walking-only';
  steps: TransitStep[];
  distanceMeters: number | null;
  durationSeconds: number | null;
};
const total = (steps: TransitStep[], key: 'distanceMeters' | 'durationSeconds') =>
  steps.every(s => typeof s[key] === 'number' && Number.isFinite(s[key]) && s[key] >= 0)
    ? steps.reduce((sum, s) => sum + s[key]!, 0) : null;

export function groupWalking(steps: TransitStep[]): WalkingGroup[] {
  const first = steps.findIndex(s => s.mode === 'TRANSIT');
  const last = steps.reduce((index, s, i) => s.mode === 'TRANSIT' ? i : index, -1);
  const groups: WalkingGroup[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].mode !== 'WALK') continue;
    const start = i;
    const walk = [steps[i]];
    while (steps[i + 1]?.mode === 'WALK') walk.push(steps[++i]);
    groups.push({
      kind: first < 0 ? 'walking-only' : start < first ? 'access' : start > last ? 'egress' : 'transfer',
      steps: walk, distanceMeters: total(walk, 'distanceMeters'), durationSeconds: total(walk, 'durationSeconds'),
    });
  }
  return groups;
}