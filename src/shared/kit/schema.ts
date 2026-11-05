/** Resource limits for a single declarative kit scene. */
export const KIT_LIMITS = {
  objects: 24,
  animationsPerObject: 8,
  particles: 4,
  labels: 6,
  overlays: 8,
  clouds: 12,
  points: 64,
  profilePoints: 32,
  particlesPerSystem: 1000,
} as const;

export const KIT_OBJECT_TYPES = [
  'box', 'sphere', 'cylinder', 'cone', 'lathe', 'rock', 'drop', 'character', 'arrow',
  'car', 'rockLayers', 'label',
] as const;

export const KIT_ANIMATION_TYPES = [
  'move', 'fall', 'roll', 'pulse', 'appear', 'disappear', 'pose',
] as const;

export const KIT_PARTICLE_TYPES = ['sparkle', 'rain', 'bubbles'] as const;
export const KIT_CAMERA_MOVES = ['static', 'dolly-in', 'pan', 'orbit', 'follow'] as const;
export const KIT_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export const KIT_POSES = ['neutral', 'wave', 'arms-up', 'point', 'squat'] as const;
