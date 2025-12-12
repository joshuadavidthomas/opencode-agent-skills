/**
 * Embedding service that manages embedding generation with caching.
 *
 * This service handles loading transformer models, generating embeddings,
 * and caching results to disk for improved performance. Model loading
 * happens asynchronously in the background.
 *
 * @example
 * ```ts
 * const service = new EmbeddingService("all-MiniLM-L6-v2");
 * await service.waitUntilReady();
 * const embedding = await service.getEmbedding("skill-name", "A description");
 * ```
 */

import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { hashContent, readCachedEmbedding, writeCachedEmbedding } from "./cache";
import { MODELS, DEFAULT_MODEL, type ModelConfig } from "./models";
import { getEmbeddingPath } from "./paths";

/**
 * Embedding strategy for generating embeddings.
 * 
 * - 'summary': Embed just the name and description as "${name}: ${description}"
 * - 'full': Embed the entire SKILL.md content if provided, fallback to summary
 */
export type EmbeddingStrategy = 'summary' | 'full';

export class EmbeddingService {
  private model: FeatureExtractionPipeline | null = null;
  private readonly modelName: string;
  private readonly modelConfig: ModelConfig;
  private readonly strategy: EmbeddingStrategy;
  private readonly ready: Promise<void>;

  /**
   * Creates a new EmbeddingService instance.
   *
   * Model loading begins immediately in the background but does not block
   * the constructor. Use `waitUntilReady()` or check `isReady()` before
   * generating embeddings.
   *
   * @param modelName - The name of the model to use (e.g., "all-MiniLM-L6-v2")
   * @param strategy - The embedding strategy to use ('summary' or 'full')
   * @throws {Error} If the model name is not recognized
   */
  constructor(modelName: string = DEFAULT_MODEL, strategy: EmbeddingStrategy = 'summary') {
    this.modelName = modelName;
    this.strategy = strategy;

    // Validate model exists in registry
    const config = MODELS[modelName];
    if (!config) {
      throw new Error(
        `Unknown model: ${modelName}. Available models: ${Object.keys(MODELS).join(", ")}`,
      );
    }
    this.modelConfig = config;

    // Start loading model in background (non-blocking)
    this.ready = this.loadModel();
  }

  /**
   * Loads the transformer model for embedding generation.
   *
   * This is called automatically by the constructor and should not be
   * called directly.
   *
   * @private
   */
  private async loadModel(): Promise<void> {
    try {
      this.model = await pipeline("feature-extraction", this.modelConfig.name, {
        dtype: this.modelConfig.quantization,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load embedding model ${this.modelConfig.name}: ${message}`,
      );
    }
  }

  /**
   * Checks if the model is loaded and ready for use.
   *
   * This is a synchronous check. Use `waitUntilReady()` if you need to
   * await until the model is loaded.
   *
   * @returns True if the model is loaded, false otherwise
   */
  isReady(): boolean {
    return this.model !== null;
  }

  /**
   * Waits until the model is loaded and ready for use.
   *
   * This method will resolve once the model loading completes (successfully
   * or with an error). If loading fails, this will throw an error.
   *
   * @throws {Error} If model loading failed
   */
  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Prepares text for embedding based on the configured strategy.
   *
   * @param name - The skill name
   * @param description - The skill description
   * @param fullContent - The full SKILL.md content (optional)
   * @returns The text to embed
   * @private
   */
  private prepareTextForEmbedding(
    name: string,
    description: string,
    fullContent?: string
  ): string {
    if (this.strategy === 'full' && fullContent) {
      return fullContent;
    }
    // Fallback to summary for 'summary' strategy or when fullContent is missing
    return `${name}: ${description}`;
  }

  /**
   * Generates an embedding for the given text with caching.
   *
   * This method first checks the cache for a previously computed embedding.
   * If found, it returns the cached result. Otherwise, it generates a new
   * embedding and writes it to the cache.
   *
   * @param name - The skill name
   * @param description - The skill description
   * @param fullContent - The full SKILL.md content (optional, used with 'full' strategy)
   * @returns A Float32Array containing the embedding vector
   * @throws {Error} If the model is not loaded or embedding generation fails
   *
   * @example
   * ```ts
   * const service = new EmbeddingService();
   * await service.waitUntilReady();
   * const embedding = await service.getEmbedding("skill-name", "A skill description");
   * console.log(embedding.length); // 384 for all-MiniLM-L6-v2
   * ```
   */
  async getEmbedding(
    name: string,
    description: string,
    fullContent?: string
  ): Promise<Float32Array> {
    // Ensure model is loaded
    if (!this.isReady()) {
      await this.waitUntilReady();
    }

    if (!this.model) {
      throw new Error("Model not initialized after waiting");
    }

    // Prepare text based on strategy
    const text = this.prepareTextForEmbedding(name, description, fullContent);

    // Check cache first (cache key is based on the actual text being embedded)
    const contentHash = hashContent(text);
    const cachePath = getEmbeddingPath(this.modelName, contentHash);

    const cachedEmbedding = await readCachedEmbedding(cachePath);
    if (cachedEmbedding) {
      return cachedEmbedding;
    }

    // Generate new embedding
    try {
      const result = await this.model(text, {
        pooling: "mean",
        normalize: true,
      });

      // Convert to Float32Array
      // result.data is a TypedArray (usually Float32Array) or regular array
      let embedding: Float32Array;
      if (result.data instanceof Float32Array) {
        embedding = result.data;
      } else if (ArrayBuffer.isView(result.data)) {
        // Handle other typed arrays by converting to regular array first
        const arrayData = Array.from(result.data as unknown as ArrayLike<number>);
        embedding = new Float32Array(arrayData);
      } else if (Array.isArray(result.data)) {
        embedding = new Float32Array(result.data);
      } else {
        throw new Error(`Unexpected result data type: ${typeof result.data}`);
      }

      // Cache the result
      await writeCachedEmbedding(cachePath, embedding);

      return embedding;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate embedding: ${message}`);
    }
  }

  /**
   * Computes the cosine similarity between two embedding vectors.
   *
   * Cosine similarity measures the cosine of the angle between two vectors,
   * producing a value between -1 and 1. Higher values indicate greater
   * similarity.
   *
   * @param a - The first embedding vector
   * @param b - The second embedding vector
   * @returns A number between -1 and 1 representing the similarity
   * @throws {Error} If the vectors have different lengths
   *
   * @example
   * ```ts
   * const service = new EmbeddingService();
   * const similarity = service.cosineSimilarity(embedding1, embedding2);
   * console.log(similarity); // e.g., 0.85
   * ```
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(
        `Vectors must have the same length (got ${a.length} and ${b.length})`,
      );
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

    // Handle zero vectors
    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
