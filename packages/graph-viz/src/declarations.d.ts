declare module 'jsonld' {
  const jsonld: {
    toRDF: (
      input: unknown,
      options?: { format?: string }
    ) => Promise<string | unknown[]>;
    expand: (input: unknown) => Promise<unknown[]>;
    compact: (input: unknown, context: unknown) => Promise<unknown>;
    flatten: (input: unknown) => Promise<unknown>;
  };
  export default jsonld;
}

declare module '3d-force-graph' {
  const ForceGraph3D: () => (container: HTMLElement) => Record<string, (...args: unknown[]) => unknown>;
  export default ForceGraph3D;
}

declare module 'three' {
  export class SphereGeometry {
    constructor(radius: number, widthSegments: number, heightSegments: number);
  }
  export class CylinderGeometry {
    constructor(radiusTop: number, radiusBottom: number, height: number, radialSegments: number);
    rotateX(angle: number): this;
  }
  export class MeshLambertMaterial {
    constructor(params: Record<string, unknown>);
  }
  export class MeshBasicMaterial {
    constructor(params: Record<string, unknown>);
  }
  export class SpriteMaterial {
    constructor(params: Record<string, unknown>);
  }
  export class Mesh {
    constructor(geometry: unknown, material: unknown);
    add(child: unknown): this;
  }
  export class Sprite {
    constructor(material: unknown);
    position: { set(x: number, y: number, z: number): void };
    scale: { set(x: number, y: number, z: number): void };
    parent?: { remove(child: unknown): void };
    material: { map?: { dispose(): void }; dispose(): void };
  }
  export class Color {
    constructor(color: string | number);
  }
  export class CanvasTexture {
    constructor(canvas: HTMLCanvasElement);
    needsUpdate: boolean;
  }
  export class TextureLoader {
    load(url: string): unknown;
  }
  export const SRGBColorSpace: string;
}
