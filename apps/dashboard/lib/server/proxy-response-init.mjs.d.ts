export function createProxiedSuccessInit(upstream: Response): {
  body: ReadableStream<Uint8Array> | null;
  status: number;
  statusText: string;
  headers: Headers;
};
