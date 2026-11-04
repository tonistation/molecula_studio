import { useState } from 'react';

import { api, type ReadResult } from './api.ts';
import { Editor } from './screens/Editor.tsx';
import { ProjectList } from './screens/ProjectList.tsx';

type View = { kind: 'list' } | { kind: 'editor'; opened: ReadResult; importNotice?: string };

export function App() {
  const [view, setView] = useState<View>({ kind: 'list' });

  const openProject = async (projectId: string, importNotice?: string) => {
    const opened = await api.read(projectId);
    setView({ kind: 'editor', opened, importNotice });
  };

  if (view.kind === 'editor') {
    return (
      <Editor
        key={view.opened.project.projectId}
        opened={view.opened}
        importNotice={view.importNotice}
        onBack={() => setView({ kind: 'list' })}
        onOpenProject={openProject}
      />
    );
  }

  return <ProjectList onOpen={openProject} />;
}
