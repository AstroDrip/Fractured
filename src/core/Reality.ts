// The three configurations of the world. Every walkable cell, obstacle and piece of
// configuration-specific geometry declares which of them it exists in, as a bitmask.

export type RealityId = 'normal' | 'void' | 'deranged';

export const R_NORMAL = 1;
export const R_VOID = 2;
export const R_DERANGED = 4;
export const R_ALL = R_NORMAL | R_VOID | R_DERANGED;

export const realityBit = (r: RealityId): number => (r === 'normal' ? R_NORMAL : r === 'void' ? R_VOID : R_DERANGED);
export const existsIn = (mask: number, r: RealityId): boolean => (mask & realityBit(r)) !== 0;
