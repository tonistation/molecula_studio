import { Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../../../shared/schema/types.ts';

/** Fit the supplied envelope without clamping: longest side is axial, other sides are head diameters. */
export function arrowShape(proportions: { width: number; height: number; depth: number }, direction: Vec3) {
  const [headDepth, headWidth, length] = [proportions.width, proportions.height, proportions.depth].sort((a, b) => a - b) as [number, number, number];
  const headLength = length * 0.35;
  const shaftLength = length - headLength;
  return {
    length, headWidth, headDepth, headLength, shaftLength,
    shaftWidth: headWidth * 0.4, shaftDepth: headDepth * 0.4,
    shaftCenter: -headLength / 2, headCenter: shaftLength / 2,
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...direction).normalize()),
  };
}
