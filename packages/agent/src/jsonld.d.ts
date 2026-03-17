declare module 'jsonld' {
  const jsonld: {
    toRDF: (
      input: unknown,
      options?: { format?: string }
    ) => Promise<string | unknown[]>;
  };
  export default jsonld;
}
