import type {
  Approval,
  Asset,
  Camera,
  CaptionStyle,
  Component,
  DigestPair,
  Entity,
  Identity,
  MediaBindings,
  Output,
  Project,
  Scene,
  SceneAudio,
  SceneVisual,
  StylizedVisual,
  Word,
} from './types.ts';

/**
 * Serializes a project with 2-space indentation, a trailing newline and the
 * key order declared by the schema. Serializing never changes revisions or
 * timestamps; it is a pure formatting operation.
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(orderProject(project), null, 2)}\n`;
}

function orderProject(project: Project): unknown {
  return {
    schemaVersion: project.schemaVersion,
    projectId: project.projectId,
    revision: project.revision,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    idea: project.idea,
    locale: project.locale,
    styleId: project.styleId,
    styleVersion: project.styleVersion,
    seed: project.seed,
    output: orderOutput(project.output),
    captionStyle: orderCaptionStyle(project.captionStyle),
    entities: project.entities.map(orderEntity),
    scenes: project.scenes.map(orderScene),
    assets: project.assets.map(orderAsset),
    approval: project.approval ? orderApproval(project.approval) : null,
  };
}

function orderOutput(output: Output): unknown {
  return {
    width: output.width,
    height: output.height,
    fps: output.fps,
    durationMs: output.durationMs,
    container: output.container,
    voiceMode: output.voiceMode,
  };
}

function orderCaptionStyle(captionStyle: CaptionStyle): unknown {
  return {
    enabled: captionStyle.enabled,
    fontId: captionStyle.fontId,
    fontSizePx: captionStyle.fontSizePx,
    color: captionStyle.color,
    highlightColor: captionStyle.highlightColor,
    anchor: captionStyle.anchor,
    safeMarginPx: captionStyle.safeMarginPx,
  };
}

function orderEntity(entity: Entity): unknown {
  return {
    entityId: entity.entityId,
    definitionVersion: entity.definitionVersion,
    generatorId: entity.generatorId,
    generatorVersion: entity.generatorVersion,
    seed: entity.seed,
    variantOf: entity.variantOf
      ? { entityId: entity.variantOf.entityId, definitionVersion: entity.variantOf.definitionVersion }
      : null,
    identity: orderIdentity(entity.identity),
  };
}

function orderIdentity(identity: Identity): unknown {
  const base = {
    type: identity.type,
    proportions: {
      width: identity.proportions.width,
      height: identity.proportions.height,
      depth: identity.proportions.depth,
    },
  };

  switch (identity.type) {
    case 'character':
      return {
        ...base,
        props: {
          bodyColor: identity.props.bodyColor,
          accentColor: identity.props.accentColor,
        },
        rigId: identity.rigId,
        voiceId: identity.voiceId,
      };
    case 'car':
      return {
        ...base,
        props: {
          bodyColor: identity.props.bodyColor,
          wheelColor: identity.props.wheelColor,
        },
        rigId: identity.rigId,
        voiceId: identity.voiceId,
      };
    case 'rockLayers':
      return {
        ...base,
        props: { colors: [...identity.props.colors] },
        rigId: identity.rigId,
        voiceId: identity.voiceId,
      };
    case 'arrow':
      return {
        ...base,
        props: {
          color: identity.props.color,
          direction: [...identity.props.direction],
        },
        rigId: identity.rigId,
        voiceId: identity.voiceId,
      };
    case 'label':
      return {
        ...base,
        props: { text: identity.props.text, color: identity.props.color },
        rigId: identity.rigId,
        voiceId: identity.voiceId,
      };
  }
}

function orderScene(scene: Scene): unknown {
  return {
    sceneId: scene.sceneId,
    revision: scene.revision,
    title: scene.title,
    startMs: scene.startMs,
    durationMs: scene.durationMs,
    text: scene.text,
    visualIntent: scene.visualIntent,
    visual: orderSceneVisual(scene.visual),
    audio: scene.audio ? orderSceneAudio(scene.audio) : null,
    words: scene.words.map(orderWord),
    mediaBindings: orderMediaBindings(scene.mediaBindings),
  };
}

function orderSceneVisual(visual: SceneVisual | null): unknown {
  if (visual === null) return null;
  if ('inert' in visual) return visual.inert;
  return orderStylizedVisual(visual);
}

function orderStylizedVisual(visual: StylizedVisual): unknown {
  return {
    templateId: visual.templateId,
    palette: visual.palette,
    background: visual.background,
    camera: orderCamera(visual.camera),
    components: visual.components.map(orderComponent),
  };
}

function orderCamera(camera: Camera): unknown {
  return {
    projection: camera.projection,
    keyframes: camera.keyframes.map((keyframe) => ({
      atMs: keyframe.atMs,
      position: [...keyframe.position],
      target: [...keyframe.target],
      fovDeg: keyframe.fovDeg,
    })),
  };
}

function orderComponent(component: Component): unknown {
  return {
    componentId: component.componentId,
    entityId: component.entityId,
    definitionVersion: component.definitionVersion,
    position: [...component.position],
    rotation: [...component.rotation],
    scale: component.scale,
    motion: component.motion,
    state: component.state,
  };
}

function orderSceneAudio(audio: SceneAudio): unknown {
  return {
    assetId: audio.assetId,
    offsetMs: audio.offsetMs,
    gainDb: audio.gainDb,
  };
}

function orderWord(word: Word): unknown {
  return {
    text: word.text,
    startMs: word.startMs,
    endMs: word.endMs,
    emphasis: word.emphasis,
  };
}

function orderMediaBindings(bindings: MediaBindings): unknown {
  return {
    audio: orderDigestPair(bindings.audio),
    words: orderDigestPair(bindings.words),
  };
}

function orderDigestPair(pair: DigestPair | null): unknown {
  return pair ? { inputDigest: pair.inputDigest, outputDigest: pair.outputDigest } : null;
}

function orderAsset(asset: Asset): unknown {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    path: asset.path,
    mimeType: asset.mimeType,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    durationMs: asset.durationMs,
    source: {
      origin: asset.source.origin,
      license: asset.source.license,
      attribution: asset.source.attribution,
    },
  };
}

function orderApproval(approval: Approval): unknown {
  return {
    contentDigest: approval.contentDigest,
    approvedRevision: approval.approvedRevision,
    approvedAt: approval.approvedAt,
  };
}
