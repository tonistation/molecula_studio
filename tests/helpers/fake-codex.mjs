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
      && [...value].length <= (node.maxLength ?? Infinity) && (!node.pattern || new RegExp(node.pattern).test(value));
    if (node.type === 'number' || node.type === 'integer') return typeof value === 'number' && Number.isFinite(value)
      && (node.type !== 'integer' || Number.isInteger(value)) && value >= (node.minimum ?? -Infinity) && value <= (node.maximum ?? Infinity);
    if (node.type === 'null') return value === null;
    throw Error('unsupported schema vocabulary');
  }
  if (schema.type !== 'object' || schema.anyOf) throw Error('root must be object');
  if (args.join(' ').includes('workspace-write') || args[0] !== 'exec' || args.at(-1) !== '-'
    || args[args.indexOf('--sandbox') + 1] !== 'read-only' || !args.includes('--skip-git-repo-check')) throw Error('unsafe flags');
  appendFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify({ args, cwd: process.cwd(), input, schema,
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
  } else if (mode === 'fail' || (mode === 'partial' && schema.properties.kind
    && readFileSync(process.env.FAKE_CODEX_RECORD, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(call => call.schema.properties.kind).length >= 2)) {
    console.error('login required secret diagnostic', process.env.VIBI_API_KEY);
    process.exitCode = 1;
  } else if (mode !== 'missing-output') {
    let output;
    if (mode === 'bad-json') output = 'invalid JSON f06-token';
    else if (mode === 'huge') output = 'x'.repeat(2097153);
    else if (schema.properties.kind) {
      output = JSON.stringify({ kind: 'kit', kitVersion: 1, palette: { background: '#87CEEB' },
        sky: { top: '#66BBFF', bottom: '#FFFFFF', sun: null, clouds: [] },
        environment: { seed: 42, terrain: { type: 'plain', color: '#66AA55', height: 1, size: 20 }, water: null },
        objects: [{ id: 'shared-rock', type: 'rock', params: { radius: 1 }, position: [0, 1, 0],
          rotation: [0, 0, 0], scale: 1, color: '#AABBCC', seed: 42, animations: [] }],
        particles: [], labels: [{ objectId: 'shared-rock', text: 'Roca', color: '#FFFFFF' }], overlays: [],
        camera: { move: 'pan', from: [0, 3, 9], to: [1, 3, 9], target: [0, 1, 0], easing: 'ease-in-out' } });
    } else output = JSON.stringify({ title: 'Guion automático de prueba', sources: [], cover: { headline: 'Una roca' },
      postText: 'Comparte esta roca.', scenes: [
        { title: 'Roca', narration: 'Una roca viaja.', visualIntent: 'Roca sobre terreno verde', seconds: 1 },
        { title: 'Otra vista', narration: 'La roca sigue.', visualIntent: 'La misma roca vista de lado', seconds: 1 },
      ] });
    if (mode === 'secret-json') output = JSON.stringify({ ...JSON.parse(output), title: 'sk-fake-sensitive-output' });
    if (!['bad-json', 'huge'].includes(mode) && !matches(JSON.parse(output))) throw Error('fake output violates schema');
    if (mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 500));
    writeFileSync(args[args.indexOf('-o') + 1], mode === 'invalid-utf8' ? Buffer.from([0xff]) : output);
  }
}
