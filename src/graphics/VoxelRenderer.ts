import {
  Mesh,
  Scene,
  Vector3,
  Color3,
  Color4,
  StandardMaterial,
  VertexData
} from '@babylonjs/core';

export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: Color3;
  type?: string;
}

// World-space height of the walkable ground surface (top face of the y = 0 voxel layer)
export const GROUND_TOP_Y = 0.5;

export interface VoxelMeshOptions {
  scale?: number;
  // Extend y = 0 voxels into columns down to y = -8 (default true)
  extrudeGround?: boolean;
}

export class VoxelRenderer {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Creates a face-culled chunk Mesh from a list of voxels.
   * Each voxel is a unit cube centred on its integer coordinates, so the top of
   * the y = 0 ground layer sits at GROUND_TOP_Y.
   */
  public createVoxelMesh(name: string, voxels: Voxel[], options: VoxelMeshOptions = {}): Mesh {
    const scale = options.scale ?? 1.0;
    const extrudeGround = options.extrudeGround ?? true;
    const voxelMap = new Map<string, Color3>();
    const getKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

    const expandedVoxels: Voxel[] = [];

    voxels.forEach(v => {
      // If voxel is ground base level (y === 0), extend vertical column downwards to y = -8
      if (extrudeGround && v.y === 0) {
        for (let cy = 0; cy >= -8; cy--) {
          const depthFactor = Math.max(0.15, 1.0 - Math.abs(cy) * 0.1);
          const col = new Color3(
            v.color.r * depthFactor,
            v.color.g * depthFactor,
            v.color.b * depthFactor
          );
          expandedVoxels.push({ x: v.x, y: cy, z: v.z, color: col });
        }
      } else {
        expandedVoxels.push(v);
      }
    });

    expandedVoxels.forEach(v => {
      voxelMap.set(getKey(v.x, v.y, v.z), v.color);
    });

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertexCount = 0;

    // Direct face meshing with culling of hidden faces
    const faces = [
      { dir: [0, 0, 1],  norm: [0, 0, 1],  verts: [[0,0,1], [1,0,1], [1,1,1], [0,1,1]] }, // North
      { dir: [0, 0, -1], norm: [0, 0, -1], verts: [[1,0,0], [0,0,0], [0,1,0], [1,1,0]] }, // South
      { dir: [1, 0, 0],  norm: [1, 0, 0],  verts: [[1,0,1], [1,0,0], [1,1,0], [1,1,1]] }, // East
      { dir: [-1, 0, 0], norm: [-1, 0, 0], verts: [[0,0,0], [0,0,1], [0,1,1], [0,1,0]] }, // West
      { dir: [0, 1, 0],  norm: [0, 1, 0],  verts: [[0,1,1], [1,1,1], [1,1,0], [0,1,0]] }, // Top
      { dir: [0, -1, 0], norm: [0, -1, 0], verts: [[0,0,0], [1,0,0], [1,0,1], [0,0,1]] }, // Bottom
    ];

    expandedVoxels.forEach(v => {
      const { x, y, z, color } = v;

      faces.forEach(face => {
        const nx = x + face.dir[0];
        const ny = y + face.dir[1];
        const nz = z + face.dir[2];

        // Cull face if neighbor exists
        if (!voxelMap.has(getKey(nx, ny, nz))) {
          // Add face vertices
          face.verts.forEach(corner => {
            positions.push(
              (x + corner[0] - 0.5) * scale,
              (y + corner[1] - 0.5) * scale,
              (z + corner[2] - 0.5) * scale
            );
            normals.push(...face.norm);
            colors.push(color.r, color.g, color.b, 1.0);
          });

          // Quad indices
          indices.push(
            vertexCount, vertexCount + 1, vertexCount + 2,
            vertexCount, vertexCount + 2, vertexCount + 3
          );
          vertexCount += 4;
        }
      });
    });

    const mesh = new Mesh(name, this.scene);
    const vertexData = new VertexData();

    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.indices = indices;
    vertexData.applyToMesh(mesh);

    const mat = new StandardMaterial(name + '_mat', this.scene);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.backFaceCulling = true;
    mesh.material = mat;

    return mesh;
  }
}
