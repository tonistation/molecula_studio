import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProceduralModel } from '../../src/shared/models/model.ts';

const model = () => ({ version: 1, name: 'Planta', semanticId: 'planta', parts: [
  { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 2, 1], color: '#117733' },
] });

test('procedural models accept bounded declarative shapes and reject executable or unbounded input', () => {
  assert.equal(validateProceduralModel(model()).ok, true);
  const invalid: unknown[] = [null, { ...model(), code: 'alert(1)' }, { ...model(), semanticId: '../file' },
    { ...model(), parts: [] }, { ...model(), parts: Array(25).fill(model().parts[0]) },
    { ...model(), parts: [{ ...model().parts[0], shape: 'url' }] },
    { ...model(), parts: [{ ...model().parts[0], color: 'https://example.com' }] },
    { ...model(), parts: [{ ...model().parts[0], scale: [Infinity, 1, 1] }] },
    JSON.parse('{"version":1,"name":"x","semanticId":"x","parts":[],"__proto__":{}}')];
  const cyclic: any = model(); cyclic.parts[0].position = cyclic;
  invalid.push(cyclic);
  for (const candidate of invalid) assert.equal(validateProceduralModel(candidate).ok, false);
});

test('procedural model validation rejects accessors, sparse arrays and extended arrays without invoking getters', () => {
  const candidate = model();
  Object.defineProperty(candidate.parts[0]!.position, '0', { enumerable: true, get() { throw new Error('executed'); } });
  assert.equal(validateProceduralModel(candidate).ok, false);
  const sparse = model(); delete sparse.parts[0]!.scale[1];
  assert.equal(validateProceduralModel(sparse).ok, false);
  const extra = model(); Object.defineProperty(extra.parts, 'hidden', { value: 1 });
  assert.equal(validateProceduralModel(extra).ok, false);
  assert.equal(validateProceduralModel({ ...model(), name: 'https://example.com' }).ok, false);
});

test('procedural model validation rejects arrays with custom prototypes without executing them', () => {
  const candidate = model();
  const prototype = Object.create(Array.prototype);
  prototype.every = () => { throw new Error('untrusted array prototype executed'); };
  Object.setPrototypeOf(candidate.parts[0]!.position, prototype);
  assert.equal(validateProceduralModel(candidate).ok, false);
});
