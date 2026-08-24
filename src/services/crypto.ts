import type { PasswordDerivation } from '@/types/models';

const PRODUCTION_ITERATIONS = 310_000;
const TEST_ITERATIONS = 2_000;

export const CURRENT_PASSWORD_DERIVATION: PasswordDerivation = {
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: import.meta.env.MODE === 'test' ? TEST_ITERATIONS : PRODUCTION_ITERATIONS,
  keyLength: 256,
  version: 1,
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function derivePassword(
  password: string,
  saltBase64: string,
  parameters: PasswordDerivation,
): Promise<string> {
  const passwordBytes = new TextEncoder().encode(password);
  const salt = base64ToBytes(saltBase64);
  const keyMaterial = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: parameters.algorithm,
      hash: parameters.hash,
      salt: Uint8Array.from(salt).buffer,
      iterations: parameters.iterations,
    },
    keyMaterial,
    parameters.keyLength,
  );
  return bytesToBase64(new Uint8Array(bits));
}

export function constantTimeEqual(leftBase64: string, rightBase64: string): boolean {
  const left = base64ToBytes(leftBase64);
  const right = base64ToBytes(rightBase64);
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}
