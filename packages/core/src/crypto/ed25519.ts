import {
  keygenAsync,
  signAsync,
  verifyAsync,
  getPublicKeyAsync,
} from '@noble/ed25519';

export interface Ed25519Keypair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export async function generateEd25519Keypair(): Promise<Ed25519Keypair> {
  return keygenAsync();
}

export async function ed25519GetPublicKey(
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  return getPublicKeyAsync(secretKey);
}

export async function ed25519Sign(
  message: Uint8Array,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  return signAsync(message, secretKey);
}

export async function ed25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  return verifyAsync(signature, message, publicKey);
}
