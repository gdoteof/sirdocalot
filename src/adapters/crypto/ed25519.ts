// Signature verification and the body digest.
//
// Ed25519 because the public key is 32 bytes and the signature 64 -- small enough
// that registering one is a paste rather than a file transfer -- and because
// there are no parameter choices to get wrong.

import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import type { Signatures } from "../../application/ports.ts";

// A raw 32-byte Ed25519 key wrapped in the DER prefix node's KeyObject wants.
// Registering a full PEM would work too, but it is multi-line, and a multi-line
// value is one that gets mangled on the way through a chat window.
const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function ed25519(): Signatures {
  return {
    verify(publicKeyBase64: string, message: string, signatureBase64: string): boolean {
      try {
        const raw = Buffer.from(publicKeyBase64, "base64");
        if (raw.length !== 32) return false;
        const key = createPublicKey({
          key: Buffer.concat([DER_PREFIX, raw]),
          format: "der",
          type: "spki",
        });
        const signature = Buffer.from(signatureBase64, "base64");
        if (signature.length !== 64) return false;
        // Ed25519 takes null as the algorithm: the hash is part of the scheme.
        return nodeVerify(null, Buffer.from(message, "utf8"), key, signature);
      } catch {
        // A malformed key or signature is a failed verification, not a crash. It
        // arrives from the network, so it is data, and refusing it is the answer.
        return false;
      }
    },

    sha256Hex(body: string): string {
      return createHash("sha256").update(body, "utf8").digest("hex");
    },
  };
}
