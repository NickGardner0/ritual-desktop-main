const STORAGE_KEY = "ritual.entities.v1";

export function entityProtocolEnabled(storage?: Pick<Storage, "getItem"> | null): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ENTITY_PROTOCOL === "0") {
    return false;
  }
  const store = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!store) return true;
  try {
    return store.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
