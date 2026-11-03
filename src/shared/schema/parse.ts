import { LIMITS, SCHEMA_VERSION } from './limits.ts';
import { ProjectJsonError, issue } from './errors.ts';
import type { IssueCode } from './errors.ts';
import type { ParseFailure, ParseOutcome } from './types.ts';
import { validateProject } from './validate.ts';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ENCODER = new TextEncoder();

/**
 * Parses bounded project bytes into a validated document.
 *
 * Order of defence: byte limit, UTF-8 decoding, strict JSON grammar with
 * duplicate/dangerous-key and depth checks, version selection, then schema
 * validation. Input-driven problems never throw.
 */
export function parseProjectText(input: string | Uint8Array): ParseOutcome {
  try {
    const text = decodeInput(input);
    const value = parseJsonText(text);
    return selectVersion(value);
  } catch (error) {
    if (error instanceof ProjectJsonError) {
      return { ok: false, failure: error.failure, issues: error.issues };
    }
    throw error;
  }
}

function decodeInput(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    // UTF-8 bytes are never shorter than UTF-16 code units, so this guard is safe.
    if (input.length > LIMITS.maxJsonBytes) throw tooLarge();
    const bytes = ENCODER.encode(input);
    if (bytes.byteLength > LIMITS.maxJsonBytes) throw tooLarge();
    return stripBom(input);
  }

  if (input.byteLength > LIMITS.maxJsonBytes) throw tooLarge();
  try {
    return stripBom(UTF8.decode(input));
  } catch {
    throw new ProjectJsonError('invalid-json', [issue('$', 'syntax', 'input is not valid UTF-8')]);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function tooLarge(): ProjectJsonError {
  return new ProjectJsonError('too-large', [
    issue('$', 'limit', `document must not exceed ${LIMITS.maxJsonBytes} bytes`),
  ]);
}

function selectVersion(value: unknown): ParseOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      failure: 'invalid-schema',
      issues: [issue('$', 'type', 'document root must be an object')],
    };
  }

  const version = (value as Record<string, unknown>).schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      failure: 'invalid-schema',
      issues: [issue('$.schemaVersion', 'const', `must be the integer ${SCHEMA_VERSION}`)],
    };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      failure: 'unsupported-version',
      issues: [
        issue(
          '$.schemaVersion',
          'const',
          `schemaVersion ${version} is newer than supported version ${SCHEMA_VERSION}`,
        ),
      ],
    };
  }

  const result = validateProject(value);
  if (!result.ok) return { ok: false, failure: 'invalid-schema', issues: result.issues };
  return result;
}

// ---------------------------------------------------------------------------
// Strict JSON parser
//
// JSON.parse accepts duplicate keys and cannot bound depth, so the document is
// read with an explicit recursive-descent parser that reports those problems
// before any schema work happens.
// ---------------------------------------------------------------------------

function parseJsonText(text: string): unknown {
  let index = 0;
  const path: Array<string | number> = [];

  const pathString = (): string => {
    let result = '$';
    for (const segment of path) {
      result += typeof segment === 'number' ? `[${segment}]` : `.${segment}`;
    }
    return result;
  };

  const fail = (failure: ParseFailure, code: IssueCode, message: string): never => {
    throw new ProjectJsonError(failure, [issue(pathString(), code, message)]);
  };

  const failSyntax = (message: string): never => fail('invalid-json', 'syntax', message);

  const isDigit = (character: string | undefined): boolean =>
    character !== undefined && character >= '0' && character <= '9';

  const skipWhitespace = (): void => {
    while (true) {
      const character = text[index];
      if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
        index += 1;
        continue;
      }
      return;
    }
  };

  const parseString = (): string => {
    index += 1; // opening quote
    let result = '';
    while (true) {
      const character = text[index];
      if (character === undefined) return failSyntax('unterminated string');
      if (character === '"') {
        index += 1;
        return result;
      }
      if (character === '\\') {
        index += 1;
        const escape = text[index];
        if (escape === undefined) return failSyntax('unterminated escape sequence');
        switch (escape) {
          case '"':
            result += '"';
            break;
          case '\\':
            result += '\\';
            break;
          case '/':
            result += '/';
            break;
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'u': {
            const hex = text.slice(index + 1, index + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return failSyntax('invalid unicode escape');
            result += String.fromCharCode(Number.parseInt(hex, 16));
            index += 4;
            break;
          }
          default:
            return failSyntax(`invalid escape sequence \\${escape}`);
        }
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        return failSyntax('unescaped control character in string');
      }
      result += character;
      index += 1;
    }
  };

  const parseNumber = (): number => {
    const start = index;
    if (text[index] === '-') index += 1;

    if (text[index] === '0') {
      index += 1;
    } else if (isDigit(text[index])) {
      while (isDigit(text[index])) index += 1;
    } else {
      return failSyntax('invalid number');
    }

    if (text[index] === '.') {
      index += 1;
      if (!isDigit(text[index])) return failSyntax('invalid number fraction');
      while (isDigit(text[index])) index += 1;
    }

    if (text[index] === 'e' || text[index] === 'E') {
      index += 1;
      if (text[index] === '+' || text[index] === '-') index += 1;
      if (!isDigit(text[index])) return failSyntax('invalid number exponent');
      while (isDigit(text[index])) index += 1;
    }

    const value = Number(text.slice(start, index));
    if (!Number.isFinite(value)) return failSyntax('number is not finite');
    return value;
  };

  const parseObject = (depth: number): Record<string, unknown> => {
    if (depth > LIMITS.maxDepth) {
      return fail('too-deep', 'depth', `nesting exceeds ${LIMITS.maxDepth}`);
    }
    index += 1; // {
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();

    skipWhitespace();
    if (text[index] === '}') {
      index += 1;
      return result;
    }

    while (true) {
      skipWhitespace();
      if (text[index] !== '"') return failSyntax('object keys must be strings');
      const key = parseString();
      path.push(key);
      if (DANGEROUS_KEYS.has(key)) {
        return fail('dangerous-key', 'dangerous-key', `key "${key}" is not allowed`);
      }
      if (keys.has(key)) {
        return fail('duplicate-key', 'unique', `duplicate key "${key}"`);
      }
      keys.add(key);

      skipWhitespace();
      if (text[index] !== ':') return failSyntax('expected ":" after object key');
      index += 1;

      result[key] = parseValue(depth);
      path.pop();

      skipWhitespace();
      const character = text[index];
      if (character === ',') {
        index += 1;
        continue;
      }
      if (character === '}') {
        index += 1;
        return result;
      }
      return failSyntax('expected "," or "}" in object');
    }
  };

  const parseArray = (depth: number): unknown[] => {
    if (depth > LIMITS.maxDepth) {
      return fail('too-deep', 'depth', `nesting exceeds ${LIMITS.maxDepth}`);
    }
    index += 1; // [
    const result: unknown[] = [];

    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return result;
    }

    while (true) {
      path.push(result.length);
      result.push(parseValue(depth));
      path.pop();

      skipWhitespace();
      const character = text[index];
      if (character === ',') {
        index += 1;
        continue;
      }
      if (character === ']') {
        index += 1;
        return result;
      }
      return failSyntax('expected "," or "]" in array');
    }
  };

  const parseValue = (depth: number): unknown => {
    skipWhitespace();
    const character = text[index];
    if (character === undefined) return failSyntax('unexpected end of input');

    if (character === '{') return parseObject(depth + 1);
    if (character === '[') return parseArray(depth + 1);
    if (character === '"') return parseString();
    if (character === '-' || isDigit(character)) return parseNumber();
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    return failSyntax(`unexpected character ${JSON.stringify(character)}`);
  };

  const value = parseValue(0);
  skipWhitespace();
  if (index !== text.length) return failSyntax('unexpected content after JSON value');
  return value;
}
