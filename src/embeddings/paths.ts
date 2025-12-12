/**
 * XDG-compliant path resolution for embedding cache.
 *
 * Provides utilities for resolving cache directories and file paths
 * for storing model embeddings, respecting XDG Base Directory specifications.
 */

import * as path from "node:path";
import { homedir } from "node:os";

/**
 * Get the base cache directory for opencode-agent-skills.
 * Respects XDG_CACHE_HOME environment variable.
 *
 * @returns The base cache directory path
 */
function getBaseCacheDir(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  if (xdgCacheHome) {
    return path.join(xdgCacheHome, "opencode-agent-skills");
  }
  return path.join(homedir(), ".cache", "opencode-agent-skills");
}

/**
 * Get the cache directory for a specific embedding model.
 *
 * Returns the full path to the cache directory where embeddings
 * for the specified model should be stored.
 *
 * @param modelName - The name of the embedding model
 * @returns The cache directory path for the model
 *
 * @example
 * ```ts
 * const cacheDir = getEmbeddingCacheDir("text-embedding-3-small");
 * // Returns: ~/.cache/opencode-agent-skills/embeddings/text-embedding-3-small/
 * ```
 */
export function getEmbeddingCacheDir(modelName: string): string {
  return path.join(getBaseCacheDir(), "embeddings", modelName);
}

/**
 * Get the full path to a specific embedding cache file.
 *
 * Returns the complete file path for storing/retrieving a cached embedding
 * based on the model name and content hash.
 *
 * @param modelName - The name of the embedding model
 * @param contentHash - The hash of the content being embedded
 * @returns The full path to the embedding cache file (.bin extension)
 *
 * @example
 * ```ts
 * const filePath = getEmbeddingPath("text-embedding-3-small", "abc123def456");
 * // Returns: ~/.cache/opencode-agent-skills/embeddings/text-embedding-3-small/abc123def456.bin
 * ```
 */
export function getEmbeddingPath(modelName: string, contentHash: string): string {
  const cacheDir = getEmbeddingCacheDir(modelName);
  return path.join(cacheDir, `${contentHash}.bin`);
}
