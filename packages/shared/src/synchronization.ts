import { HealthEventSchema, mergeHealthEvents, normalizeHealthEvent, type HealthEvent, type ValidationIssue } from "./health-events";

export type SynchronizationResult = {
  events: HealthEvent[];
  issues: ValidationIssue[];
  acceptedIncoming: number;
  rejectedIncoming: number;
  insertedIncoming: number;
};

export function synchronizeHealthEvents(
  existing: HealthEvent[],
  incoming: unknown[],
  now = new Date()
): SynchronizationResult {
  const issues: ValidationIssue[] = [];
  const normalizedIncoming: HealthEvent[] = [];
  let rejectedIncoming = 0;

  for (const candidate of incoming) {
    const normalized = normalizeHealthEvent(candidate, now);
    issues.push(...normalized.issues);
    if (normalized.event) normalizedIncoming.push(normalized.event);
    else rejectedIncoming += 1;
  }

  const validatedExisting = existing.flatMap((event) => {
    const parsed = HealthEventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const existingIds = new Set(validatedExisting.map((event) => event.id));
  const merged = mergeHealthEvents([...validatedExisting, ...normalizedIncoming]);
  issues.push(...merged.issues);

  return {
    events: merged.events,
    issues,
    acceptedIncoming: normalizedIncoming.length,
    rejectedIncoming,
    insertedIncoming: normalizedIncoming.filter((event) => !existingIds.has(event.id)).length
  };
}
