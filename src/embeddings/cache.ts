import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Generates a SHA-256 hash of the given text content.
 * Used for creating stable cache keys for embeddings.
 *
 * @param text - The text content to hash
 * @returns A hexadecimal string representation of the SHA-256 hash
 *
 * @example
 * ```ts
 * const hash = hashContent("Hello, world!");
 * // Returns: "315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3"
 * ```
 */
export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Reads a cached embedding from disk as a Float32Array.
 * Returns null if the file doesn't exist or cannot be read.
 *
 * @param filePath - Absolute path to the cached embedding file
 * @returns The embedding as a Float32Array, or null if not found or on error
 *
 * @example
 * ```ts
 * const embedding = await readCachedEmbedding("/path/to/cache/abc123.bin");
 * if (embedding) {
 *   console.log("Loaded embedding with", embedding.length, "dimensions");
 * }
 * ```
 */
export async function readCachedEmbedding(
  filePath: string,
): Promise<Float32Array | null> {
  try {
    const buffer = await fs.readFile(filePath);
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  } catch (error) {
    // Gracefully handle missing files and permission errors
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "EACCES")
    ) {
      return null;
    }
    // Log unexpected errors but still return null
    console.error(`Failed to read cached embedding from ${filePath}:`, error);
    return null;
  }
}

/**
 * Writes an embedding to disk in binary format.
 * Creates parent directories if they don't exist.
 *
 * @param filePath - Absolute path where the embedding should be written
 * @param embedding - The Float32Array embedding to persist
 *
 * @throws {Error} If the directory cannot be created or the file cannot be written
 *
 * @example
 * ```ts
 * const embedding = new Float32Array([0.1, 0.2, 0.3]);
 * await writeCachedEmbedding("/path/to/cache/abc123.bin", embedding);
 * ```
 */
export async function writeCachedEmbedding(
  filePath: string,
  embedding: Float32Array,
): Promise<void> {
  // Create parent directories if needed
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Write the raw Float32Array buffer to disk
  const buffer = Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );
  await fs.writeFile(filePath, buffer);
}
