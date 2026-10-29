import { Mesh, Matrix, Quaternion, Vector3 } from '@babylonjs/core';

const tmpS = new Vector3(), tmpT = new Vector3(), tmpQ = new Quaternion(), tmpM = new Matrix();

/**
 * Accumulates static thin instances (one draw call per batch) with optional
 * per-instance colour. Used for every repeated prop in the chapter.
 */
export class ThinBatch {
  private matrices: number[] = [];
  private colors: number[] = [];
  private useColor: boolean;

  constructor(public readonly mesh: Mesh, useColor = true) {
    this.useColor = useColor;
  }

  public get count(): number { return this.matrices.length / 16; }

  public add(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0,
             sx = 1, sy = 1, sz = 1, r = 1, g = 1, b = 1, a = 1): void {
    tmpS.set(sx, sy, sz);
    tmpT.set(x, y, z);
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, tmpQ);
    Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpM);
    const m = tmpM.m;
    for (let i = 0; i < 16; i++) this.matrices.push(m[i]);
    if (this.useColor) this.colors.push(r, g, b, a);
  }

  public addMatrix(m: Matrix, r = 1, g = 1, b = 1, a = 1): void {
    for (let i = 0; i < 16; i++) this.matrices.push(m.m[i]);
    if (this.useColor) this.colors.push(r, g, b, a);
  }

  public commit(): Mesh {
    if (this.count === 0) {
      this.mesh.setEnabled(false);
      return this.mesh;
    }
    this.mesh.thinInstanceSetBuffer('matrix', new Float32Array(this.matrices), 16, true);
    if (this.useColor) this.mesh.thinInstanceSetBuffer('color', new Float32Array(this.colors), 4, true);
    this.mesh.thinInstanceRefreshBoundingInfo(false);
    this.mesh.isPickable = false;
    this.mesh.freezeWorldMatrix();
    this.matrices = [];
    this.colors = [];
    return this.mesh;
  }
}
