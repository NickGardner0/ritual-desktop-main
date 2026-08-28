export async function auth() {
  return {
    userId: null,
    getToken: async () => null,
  };
}

export function currentUser() {
  return null;
}
