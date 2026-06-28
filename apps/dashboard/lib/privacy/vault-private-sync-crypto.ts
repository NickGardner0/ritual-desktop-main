"use client";

export const PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM = "AES-GCM";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is required for Private Sync encryption.");
  }
  return globalThis.crypto;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8String(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await webCrypto().subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function importAesGcmKey(
  keyBase64: string,
  usages: KeyUsage[] = ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  return webCrypto().subtle.importKey(
    "raw",
    base64ToBytes(keyBase64),
    PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
    false,
    usages,
  );
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  webCrypto().getRandomValues(bytes);
  return bytes;
}

export function randomBase64Key(length = 32): string {
  return bytesToBase64(randomBytes(length));
}

export async function deriveAesGcmKeyFromPassphrase({
  passphrase,
  salt,
  iterations,
}: {
  passphrase: string;
  salt: Uint8Array;
  iterations: number;
}): Promise<CryptoKey> {
  const baseKey = await webCrypto().subtle.importKey(
    "raw",
    utf8Bytes(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return webCrypto().subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}
