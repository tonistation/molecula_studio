import React from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewPlayer } from '../../studio/src/components/PreviewPlayer.tsx';
import type { Project } from '../../src/shared/schema/types.ts';

const root = createRoot(document.getElementById('root')!);
Object.assign(window, {
  showPreview: (draft: Project) => root.render(<PreviewPlayer draft={draft} seek={null} missingAssets={[]} />),
});
