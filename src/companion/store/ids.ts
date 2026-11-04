import { randomUUID } from 'node:crypto';

/**
 * Project IDs become directory names, so they follow the schema ID grammar and
 * never contain separators, dots, percent-encoding or backslashes.
 *
 * Mirrors the schema rule documented in project-format.md; the shared validator
 * keeps its own copy because it must stay dependency-free.
 */
export const PROJECT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Operation IDs are used inside temp file names, never as paths by themselves. */
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

export function isValidOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}

/**
 * Generates `p-<32 hex>` from a UUIDv4. The UUID dashes are removed so the
 * result stays inside the schema ID grammar.
 */
export function newProjectId(): string {
  return `p-${randomUUID().replaceAll('-', '')}`;
}

/** Generates a filename-safe operation ID (`op-<uuid>`). */
export function newOperationId(): string {
  return `op-${randomUUID()}`;
}
