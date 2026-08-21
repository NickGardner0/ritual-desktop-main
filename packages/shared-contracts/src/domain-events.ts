export const DOMAIN_EVENT_VERSION = 1 as const;

export const DOMAIN_EVENT_TYPES = [
  "habit.log.recorded",
  "habit.definition.changed",
  "assistant.turn.completed",
  "computer.activity.synced",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export type DomainEvent<TType extends DomainEventType = DomainEventType, TPayload = Record<string, unknown>> = {
  version: typeof DOMAIN_EVENT_VERSION;
  type: TType;
  occurredAt: string;
  userId: string;
  idempotencyKey: string;
  payload: TPayload;
};
