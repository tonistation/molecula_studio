import type { Issue, ParseFailure } from './types.ts';

export type IssueCode =
  | 'required'
  | 'unknown-key'
  | 'type'
  | 'range'
  | 'pattern'
  | 'path'
  | 'const'
  | 'unique'
  | 'reference'
  | 'order'
  | 'sum'
  | 'layout'
  | 'grid'
  | 'limit'
  | 'binding'
  | 'digest'
  | 'text-control'
  | 'date'
  | 'date-order'
  | 'cycle'
  | 'depth'
  | 'dangerous-key'
  | 'syntax';

export function issue(path: string, code: IssueCode, message: string): Issue {
  return { path, code, message };
}

/** Error used internally by the parser; never escapes `parseProjectText`. */
export class ProjectJsonError extends Error {
  readonly failure: ParseFailure;
  readonly issues: Issue[];

  constructor(failure: ParseFailure, issues: Issue[]) {
    super(issues.map((item) => `${item.path}: ${item.message}`).join('; ') || failure);
    this.name = 'ProjectJsonError';
    this.failure = failure;
    this.issues = issues;
  }
}

export function childPath(path: string, key: string): string {
  return `${path}.${key}`;
}
