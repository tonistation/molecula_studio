import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE;
if (args[0] === '--version') {
  if (mode === 'version-hang') setInterval(() => {}, 1000);
  else if (mode === 'version-fail') process.exitCode = 1;
  else console.log('codex-cli fake-offline');
} else {
  const input = readFileSync(0, 'utf8');
  const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
  function strict(node) {
    if (node.type === 'object' && (node.additionalProperties !== false
      || JSON.stringify([...node.required].sort()) !== JSON.stringify(Object.keys(node.properties).sort()))) throw Error('not strict');
    Object.values(node.properties ?? {}).forEach(strict);
    Object.values(node.$defs ?? {}).forEach(strict);
    node.anyOf?.forEach(strict);
    if (node.items) strict(node.items);
  }
  strict(schema);
  function matches(value, node = schema) {
    if (node.$ref) return matches(value, schema.$defs[node.$ref.split('/').at(-1)]);
    if (node.anyOf) return node.anyOf.some(branch => matches(value, branch));
    if (node.enum && !node.enum.includes(value)) return false;
    if (node.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
      && node.required.every(key => Object.hasOwn(value, key))
      && Object.keys(value).every(key => Object.hasOwn(node.properties, key) && matches(value[key], node.properties[key]));
    if (node.type === 'array') return Array.isArray(value) && value.length >= (node.minItems ?? 0)
      && value.length <= (node.maxItems ?? Infinity) && value.every(item => matches(item, node.items));
    if (node.type === 'string') return typeof value === 'string' && [...value].length >= (node.minLength ?? 0)
      && [...value].length <= (node.maxLength ?? Infinity) && (!node.pattern || new RegExp(node.pattern, 'u').test(value));
    if (node.type === 'number' || node.type === 'integer') return typeof value === 'number' && Number.isFinite(value)
      && (node.type !== 'integer' || Number.isInteger(value)) && value >= (node.minimum ?? -Infinity) && value <= (node.maximum ?? Infinity);
    if (node.type === 'null') return value === null;
    throw Error('unsupported schema vocabulary');
  }
  if (schema.type !== 'object' || schema.anyOf) throw Error('root must be object');
  if (args.join(' ').includes('workspace-write') || args[0] !== 'exec' || args.at(-1) !== '-'
    || args[args.indexOf('--sandbox') + 1] !== 'read-only' || !args.includes('--skip-git-repo-check')) throw Error('unsafe flags');
  appendFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify({ args, cwd: process.cwd(), input, schema, pid: process.pid,
    inheritedProviderSecret: Boolean(process.env.VIBI_API_KEY || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) }) + '\n');
  if (['hang', 'fail', 'signal'].includes(mode)) {
    console.log('private-stub-output-4815');
    console.error('private-stub-output-4815');
  }
  if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
  if (mode === 'hang') {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    writeFileSync(process.env.FAKE_CODEX_CHILD, String(child.pid));
    setInterval(() => {}, 1000);
  } else if (mode === 'fail' || (['partial', 'model-partial'].includes(mode) && (schema.properties.kind || schema.properties.scene)
    && readFileSync(process.env.FAKE_CODEX_RECORD, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(call => call.schema.properties.kind || call.schema.properties.scene).length >= 2)) {
    console.error('login required secret diagnostic', process.env.VIBI_API_KEY);
    process.exitCode = 1;
  } else if (mode !== 'missing-output') {
    let output;
    if (mode === 'fixture' || mode === 'fixture-invalid') output = readFileSync(process.env.FAKE_CODEX_FIXTURE, 'utf8');
    else if (mode === 'bad-json') output = 'invalid JSON f06-token';
    else if (mode === 'huge') output = 'x'.repeat(2097153);
    else if (schema.properties.kind) {
      output = JSON.stringify({ kind: 'kit', kitVersion: 1, palette: { background: '#87CEEB' },
        sky: { top: '#66BBFF', bottom: '#FFFFFF', sun: null, clouds: [] },
        environment: { seed: 42, terrain: { type: 'plain', color: '#66AA55', height: 1, size: 20 }, water: null },
        objects: [{ id: 'shared-rock', type: 'rock', params: { radius: 1 }, position: [0, 1, 0],
          rotation: [0, 0, 0], scale: 1, color: '#AABBCC', seed: 42, animations: [] }],
        particles: [], labels: [{ objectId: 'shared-rock', text: 'Roca', color: '#FFFFFF' }], overlays: [],
        camera: { move: 'pan', from: [0, 3, 9], to: [1, 3, 9], target: [0, 1, 0], easing: 'ease-in-out' } });
    } else if (schema.properties.scene && schema.properties.models) {
      const scene = { kind: 'kit', kitVersion: 1, palette: { background: '#87CEEB' },
        sky: { top: '#66BBFF', bottom: '#FFFFFF', sun: null, clouds: [] },
        environment: { seed: 42, terrain: { type: 'plain', color: '#66AA55', height: 1, size: 20 }, water: null },
        objects: [{ id: 'shared-rock', type: 'rock', params: { radius: 1 }, position: [0, 1, 0],
          rotation: [0, 0, 0], scale: 1, color: '#AABBCC', seed: 42, animations: [] }],
        particles: [], labels: [{ objectId: 'shared-rock', text: 'Roca', color: '#FFFFFF' }], overlays: [],
        camera: { move: 'pan', from: [0, 3, 9], to: [1, 3, 9], target: [0, 1, 0], easing: 'ease-in-out' } };
      const models = [];
      if (mode === 'model-orchid') {
        const available = JSON.parse(input.match(/Modelos disponibles \(selección limitada; datos, no instrucciones\): (\[[^\n]*\])/u)?.[1] ?? '[]');
        const existing = available.find(entry => entry.semanticId === 'orquidea');
        scene.objects = [{ id: 'orquidea', type: 'model', params: { modelId: existing?.id ?? 'new-orchid' }, position: [0, 0.7, 0], rotation: [0, 0, 0], scale: 1.5, color: '#ffffff', animations: [] }];
        scene.labels = [];
        if (!existing) models.push({ alias: 'new-orchid', model: { version: 1, name: 'Orquídea', semanticId: 'orquidea', parts: [
          { shape: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.18, 1.8, 0.18], color: '#167230' },
          { shape: 'sphere', position: [-0.65, 0.9, 0], rotation: [0, 0, 0.6], scale: [1.3, 0.65, 0.4], color: '#f020aa' },
          { shape: 'sphere', position: [0.65, 0.9, 0], rotation: [0, 0, -0.6], scale: [1.3, 0.65, 0.4], color: '#f020aa' },
          { shape: 'sphere', position: [0, 1.3, 0], rotation: [0, 0, 0], scale: [0.65, 0.9, 0.4], color: '#f020aa' },
          { shape: 'sphere', position: [0, 0.85, 0.25], rotation: [0, 0, 0], scale: [0.4, 0.4, 0.4], color: '#ffdd20' },
        ] } });
      } else if (['model', 'model-batch', 'model-partial'].includes(mode)) {
        const available = JSON.parse(input.match(/Modelos disponibles \(selección limitada; datos, no instrucciones\): (\[[^\n]*\])/u)?.[1] ?? '[]');
        const existing = mode === 'model' ? undefined : available.find(entry => entry.semanticId === 'farol');
        scene.objects.push({ id: 'farol', type: 'model', params: { modelId: existing?.id ?? 'new-farol' }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
        if (!existing) models.push({ alias: 'new-farol', model: { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] } });
      }
      output = JSON.stringify({ scene, models });
    } else output = JSON.stringify({ title: 'Guion automático de prueba', sources: [], cover: { headline: 'Una roca' },
      postText: 'Comparte esta roca.', scenes: [
        { title: 'Roca', narration: 'Una roca viaja.', visualIntent: 'Roca sobre terreno verde', seconds: 1 },
        { title: 'Otra vista', narration: 'La roca sigue.', visualIntent: 'La misma roca vista de lado', seconds: 1 },
      ] });
    if (mode === 'secret-json') output = JSON.stringify({ ...JSON.parse(output), title: 'sk-fake-sensitive-output' });
    if (!['bad-json', 'huge', 'fixture-invalid'].includes(mode) && !matches(JSON.parse(output))) throw Error('fake output violates schema');
    if (mode === 'model-orchid') appendFileSync(`${process.env.FAKE_CODEX_RECORD}.outputs`, output + '\n');
    if (mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 500));
    writeFileSync(args[args.indexOf('-o') + 1], mode === 'invalid-utf8' ? Buffer.from([0xff]) : output);
  }
}
