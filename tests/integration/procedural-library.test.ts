import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelLibrary } from '../../src/companion/store/model-library.ts';

const model = { version: 1 as const, name: 'Planta', semanticId: 'planta', parts: [
  { shape: 'sphere' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 2, 1] as [number, number, number], color: '#117733' },
] };

test('workspace library stores immutable content addressed definitions across instances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  try {
    const first = new ModelLibrary(root), second = new ModelLibrary(root);
    const ids = await Promise.all([first.put(model), second.put(model)]);
    assert.equal(ids[0], ids[1]);
    assert.deepEqual(await second.get(ids[0]!), model);
    assert.deepEqual(await second.find('planta'), [{ id: ids[0], model }]);
    await assert.rejects(first.put({ ...model, parts: [] }));
    assert.equal((await first.find('planta')).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent distinct models remain in the shared catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  try {
    const first = new ModelLibrary(root), second = new ModelLibrary(root);
    const other = { ...model, name: 'Otra planta' };
    const ids = await Promise.all([first.put(model), second.put(other)]);
    assert.deepEqual(await first.get(ids[0]!), model);
    assert.deepEqual(await second.get(ids[1]!), other);
    assert.equal((await first.find('planta')).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch publication validates all models before changing the catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  try {
    const library = new ModelLibrary(root);
    const id = await library.put(model);
    const before = await readFile(join(root, '.models'), 'utf8');
    await assert.rejects(library.putMany([{ ...model, name: 'Otra planta' }, { ...model, parts: [] }]));
    assert.equal(await readFile(join(root, '.models'), 'utf8'), before);
    assert.deepEqual(await library.get(id), model);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch publication rejects arrays with executable accessors or custom prototypes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  try {
    const library = new ModelLibrary(root);
    const malicious = [model];
    let executed = false;
    Object.defineProperty(malicious, '0', { get() { executed = true; return model; }, enumerable: true });
    await assert.rejects(library.putMany(malicious));
    assert.equal(executed, false);
    const custom = [model];
    Object.setPrototypeOf(custom, { map() { executed = true; } });
    await assert.rejects(library.putMany(custom));
    assert.equal(executed, false);
    await assert.rejects(readFile(join(root, '.models')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent batches publish every model and return content addresses in input order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  try {
    const first = new ModelLibrary(root), second = new ModelLibrary(root);
    const other = { ...model, name: 'Otra planta' };
    const third = { ...model, name: 'Tercera planta' };
    const [ids, more] = await Promise.all([first.putMany([model, other, model]), second.putMany([third])]);
    assert.equal(ids[0], ids[2]);
    assert.deepEqual(await Promise.all([first.get(ids[0]!), first.get(ids[1]!), first.get(more[0]!)]), [model, other, third]);
    assert.equal((await first.find('planta')).length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('queued writes snapshot validated caller data before asynchronous work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  try {
    const mutable = structuredClone(model);
    const library = new ModelLibrary(root);
    const pending = library.put(mutable);
    mutable.name = 'Alterada';
    const id = await pending;
    assert.deepEqual(await library.get(id), model);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('catalog replacement with a symlink during publication never writes outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'models-outside-'));
  try {
    const target = join(outside, 'target');
    await writeFile(target, 'untouched');
    const library = new ModelLibrary(root, async () => {
      await symlink(target, join(root, '.models'));
    });
    const id = await library.put(model);
    assert.equal(await readFile(target, 'utf8'), 'untouched');
    assert.deepEqual(await library.get(id), model);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('workspace library refuses symlinked storage and malformed model identifiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'models-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'models-outside-'));
  try {
    await symlink(outside, join(root, '.models'));
    const library = new ModelLibrary(root);
    await assert.rejects(library.put(model));
    await assert.rejects(library.get('../other'));
    await assert.rejects(readFile(join(outside, 'planta.json')));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
