declare module 'rdf-canonize' {
  interface CanonizeOptions {
    algorithm: 'RDFC-1.0' | 'URDNA2015';
    inputFormat?: 'application/n-quads';
    format?: 'application/n-quads';
    messageDigestAlgorithm?: string;
    signal?: AbortSignal;
    maxWorkFactor?: number;
  }

  interface RdfCanonize {
    canonize(input: string, options: CanonizeOptions): Promise<string>;
    NQuads: {
      parse(nquads: string): object[];
      serialize(dataset: object[]): string;
    };
  }

  const canonize: RdfCanonize;
  export default canonize;
}
