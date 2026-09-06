import type { EntityRef, EntitySummary } from "@ritual/shared-contracts";

export const ENTITY_SUMMARY_TTL_MS: number;

export function entitySummaryCacheKey(userId: string | null | undefined, ref: EntityRef): string;
export function shouldPersistEntitySummary(summary: EntitySummary): boolean;

export class EntitySummaryCache {
  get(key: string, now?: number): EntitySummary | undefined;
  set(key: string, summary: EntitySummary, now?: number): boolean;
  delete(key: string): void;
  clear(): void;
  dedupe(key: string, loader: () => Promise<EntitySummary>): Promise<EntitySummary>;
  subscribe(key: string, listener: () => void): () => void;
}

export function getEntitySummaryCacheUser(): string | null;
export function setEntitySummaryCacheUser(userId: string | null): void;
export function peekEntitySummary(ref: EntityRef, userId?: string | null): EntitySummary | undefined;
export function rememberEntitySummary(summary: EntitySummary, userId?: string | null): void;
export function forgetEntitySummary(ref: EntityRef, userId?: string | null): void;
export function subscribeEntitySummary(ref: EntityRef, listener: () => void, userId?: string | null): () => void;
export function subscribeEntitySummaries(listener: () => void): () => void;
export function clearEntitySummaryCache(): void;
export function loadEntitySummary(
  ref: EntityRef,
  userId: string | null | undefined,
  loader: () => Promise<EntitySummary>,
): Promise<EntitySummary>;
export function readCachedEntitySummary(ref: EntityRef, userId: string | null | undefined): EntitySummary | undefined;
export function writeCachedEntitySummary(
  ref: EntityRef,
  userId: string | null | undefined,
  summary: EntitySummary,
): void;
