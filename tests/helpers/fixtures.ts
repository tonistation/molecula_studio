import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectsDir = fileURLToPath(new URL('../../fixtures/projects/', import.meta.url));

export function fixtureText(name: string): string {
  return readFileSync(join(projectsDir, `${name}.json`), 'utf8');
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(projectsDir, `${name}.json`)));
}

export function fixtureJson(name: string): any {
  return JSON.parse(fixtureText(name));
}

export function fixtureCopy(name: string): any {
  return structuredClone(fixtureJson(name));
}
