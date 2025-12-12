/**
 * Hugging Face transformer model configuration registry.
 *
 * This module defines the available embedding models and their configurations
 * for use with Transformers.js. Each model has specific characteristics that
 * affect performance, accuracy, and resource usage.
 */

/**
 * Configuration for a Hugging Face transformer model.
 */
export interface ModelConfig {
  /** Full Hugging Face model name (e.g., "Xenova/all-MiniLM-L6-v2") */
  name: string;
  /** Embedding vector dimensions */
  dimensions: number;
  /** Maximum token length */
  maxTokens: number;
  /** Quantization setting for model weights */
  quantization: "fp32" | "fp16" | "q8";
}

/**
 * Registry of available Hugging Face transformer models.
 *
 * Models are optimized for different trade-offs:
 * - Smaller models (L3, L6) are faster but less accurate
 * - Larger models (L12, mpnet) are more accurate but slower
 * - All models use q8 quantization for reasonable size/performance balance
 */
export const MODELS: Record<string, ModelConfig> = {
  "paraphrase-MiniLM-L3-v2": {
    name: "Xenova/paraphrase-MiniLM-L3-v2",
    dimensions: 384,
    maxTokens: 128,
    quantization: "q8",
  },
  "all-MiniLM-L6-v2": {
    name: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
    maxTokens: 256,
    quantization: "q8",
  },
  "all-MiniLM-L12-v2": {
    name: "Xenova/all-MiniLM-L12-v2",
    dimensions: 384,
    maxTokens: 256,
    quantization: "q8",
  },
  "all-mpnet-base-v2": {
    name: "Xenova/all-mpnet-base-v2",
    dimensions: 768,
    maxTokens: 384,
    quantization: "q8",
  },
  "bge-small-en-v1.5": {
    name: "Xenova/bge-small-en-v1.5",
    dimensions: 384,
    maxTokens: 512,
    quantization: "q8",
  },
};

/**
 * Default model for embedding generation.
 *
 * all-MiniLM-L6-v2 provides a good balance of speed, accuracy, and resource usage
 * for most use cases. It supports 256 tokens and produces 384-dimensional embeddings.
 */
export const DEFAULT_MODEL = "all-MiniLM-L6-v2";
