/**
 * Contract constants for current projects and bounded legacy input.
 *
 * Single source of truth: validators, editor limits and future companion
 * checks must import these values instead of repeating literals.
 */
export const SCHEMA_VERSION = 3;

export const LIMITS = {
  maxJsonBytes: 2 * 1024 * 1024,
  maxDepth: 16,
  maxScenes: 12,
  maxScriptSources: 12,
  maxSourceUrl: 2048,
  maxPostText: 4000,
  maxEntities: 32,
  maxAssets: 100,
  maxWordsPerScene: 300,
  maxWordsPerProject: 1500,
  maxTotalText: 12000,
  maxSceneText: 2000,
  maxDurationMs: 60000,
  minSceneMs: 1000,
  maxSceneMs: 15000,
  maxComponents: 16,
  maxCameraKeyframes: 8,
  maxAssetBytes: 52_428_800,
  maxAudioDurationMs: 60000,
  timeStepMs: 100,
} as const;
