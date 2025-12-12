/**
 * Embedding generation for semantic skill matching.
 *
 * Uses all-MiniLM-L6-v2 with q8 quantization for optimal balance.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/** Hardcoded model configuration */
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const QUANTIZATION = "q8";

/** Module-level model instance (lazy loaded) */
let model: FeatureExtractionPipeline | null = null;
let modelPromise: Promise<void> | null = null;

/**
 * Ensure the model is loaded (lazy initialization).
 */
async function ensureModel(): Promise<void> {
  if (model) return;
  if (!modelPromise) {
    modelPromise = (async () => {
      model = await pipeline("feature-extraction", MODEL_NAME, { dtype: QUANTIZATION });
    })();
  }
  await modelPromise;
}

/**
 * Get cache file path for an embedding.
 */
function getCachePath(contentHash: string): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  const baseDir = xdgCacheHome
    ? path.join(xdgCacheHome, "opencode-agent-skills")
    : path.join(homedir(), ".cache", "opencode-agent-skills");
  return path.join(baseDir, "embeddings", `${contentHash}.bin`);
}

/**
 * Generate an embedding for the given name and description.
 *
 * Results are cached to disk based on content hash.
 *
 * @param name - Skill name
 * @param description - Skill description
 * @returns 384-dimensional embedding vector
 */
export async function getEmbedding(name: string, description: string): Promise<Float32Array> {
  await ensureModel();
  if (!model) throw new Error("Model failed to load");

  const text = `${name}: ${description}`;
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const cachePath = getCachePath(hash);

  // Try cache first
  try {
    const buffer = await fs.readFile(cachePath);
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  } catch {
    // Cache miss, generate new embedding
  }

  // Generate embedding
  const result = await model(text, { pooling: "mean", normalize: true });

  let embedding: Float32Array;
  if (result.data instanceof Float32Array) {
    embedding = result.data;
  } else if (ArrayBuffer.isView(result.data)) {
    embedding = new Float32Array(Array.from(result.data as unknown as ArrayLike<number>));
  } else if (Array.isArray(result.data)) {
    embedding = new Float32Array(result.data);
  } else {
    throw new Error(`Unexpected result data type: ${typeof result.data}`);
  }

  // Cache the result
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));

  return embedding;
}

/**
 * Compute cosine similarity between two embedding vectors.
 *
 * @param a - First embedding
 * @param b - Second embedding
 * @returns Similarity score between -1 and 1
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vectors must have the same length (got ${a.length} and ${b.length})`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    if (valA === undefined || valB === undefined) {
      throw new Error(`Unexpected undefined value at index ${i}`);
    }
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
