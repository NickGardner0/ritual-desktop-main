export function headers() {
  return new Headers();
}

export function cookies() {
  return {
    get: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
