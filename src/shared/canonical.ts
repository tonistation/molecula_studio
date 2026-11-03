/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Used as the fixed `binding-v1` hashing input. Only JSON data is accepted:
 * no undefined, functions, symbols, bigints, non-finite numbers, dates,
 * class instances or cycles. Object keys sort by UTF-16 code units, which is
 * exactly what `Array.prototype.sort()` does for strings.
 */
export function canonicalize(value: unknown): string {
  return writeValue(value, []);
}

function writeValue(value: unknown, stack: object[]): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonicalize: only finite numbers are valid JSON');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      return writeContainer(value, stack);
    default:
      throw new TypeError(`canonicalize: ${typeof value} is not valid JSON data`);
  }
}

function writeContainer(value: object, stack: object[]): string {
  if (stack.includes(value)) {
    throw new TypeError('canonicalize: cyclic structures are not valid JSON data');
  }
  stack.push(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        items.push(writeValue(value[index], stack));
      }
      return `[${items.join(',')}]`;
    }

    if (!isPlainObject(value)) {
      throw new TypeError('canonicalize: only plain objects are valid JSON data');
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${writeValue(record[key], stack)}`,
    );
    return `{${entries.join(',')}}`;
  } finally {
    stack.pop();
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
