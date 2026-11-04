import { startCompanionServer } from '../../src/companion/server/http.ts';
import { ProjectStore } from '../../src/companion/store/project-store.ts';
import { createNodeFsOps } from '../../src/companion/store/fs-ops.ts';

// Separate test entrypoint: production CLI has no fault switches. All other
// store/server operations use the real implementation and owned temporary disk.
const fs = createNodeFsOps();
const store = new ProjectStore({ workspaceRoot: process.env.MOLECULA_WORKSPACE!, fsOps: {
  ...fs,
  writeFileExclusive: async (path, bytes) => {
    if (path.includes('project.json.tmp-')) {
      if (process.env.MOLECULA_TEST_FAULT === 'write') throw new Error('F08 injected disk write failure');
      await fs.writeFileExclusive(path, bytes.subarray(0, 17));
      console.error('F08_PARTIAL_TEMP_WRITTEN');
      await new Promise(() => undefined); // Parent deliberately kills this owned child.
    }
    return fs.writeFileExclusive(path, bytes);
  },
} });
await store.init();
const handle = await startCompanionServer({ workspaceRoot: process.env.MOLECULA_WORKSPACE!, store,
  studioDir: process.env.MOLECULA_STUDIO_DIR!, port: Number(process.env.MOLECULA_PORT) });
console.error(`F08 fault companion ready at ${handle.origin}`);
process.on('SIGTERM', () => { void handle.close().then(() => process.exit(0)); });
