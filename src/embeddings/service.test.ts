/**
 * Tests for EmbeddingService
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { EmbeddingService } from "./service";
import { DEFAULT_MODEL } from "./models";
import { getEmbeddingPath } from "./paths";
import { hashContent } from "./cache";

describe("EmbeddingService", () => {
  let service: EmbeddingService;
  let testCacheDir: string;

  beforeEach(() => {
    service = new EmbeddingService(DEFAULT_MODEL);
    const xdgCacheHome = process.env.XDG_CACHE_HOME;
    const baseDir = xdgCacheHome
      ? path.join(xdgCacheHome, "opencode-agent-skills")
      : path.join(homedir(), ".cache", "opencode-agent-skills");
    testCacheDir = path.join(baseDir, "embeddings", DEFAULT_MODEL);
  });

  afterEach(async () => {
    // Clean up test cache files
    try {
      await fs.rm(testCacheDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    test("creates instance with default model", () => {
      const svc = new EmbeddingService();
      expect(svc).toBeDefined();
      expect(svc.isReady()).toBe(false);
    });

    test("creates instance with specific model", () => {
      const svc = new EmbeddingService("all-MiniLM-L12-v2");
      expect(svc).toBeDefined();
      expect(svc.isReady()).toBe(false);
    });

    test("throws error for unknown model", () => {
      expect(() => new EmbeddingService("invalid-model")).toThrow(
        "Unknown model: invalid-model",
      );
    });

    test("starts loading model immediately", async () => {
      const svc = new EmbeddingService();
      // Model should not be ready immediately
      expect(svc.isReady()).toBe(false);
      // But it should become ready after waiting
      await svc.waitUntilReady();
      expect(svc.isReady()).toBe(true);
    });
  });

  describe("isReady and waitUntilReady", () => {
    test("isReady returns false before model loads", () => {
      expect(service.isReady()).toBe(false);
    });

    test("isReady returns true after model loads", async () => {
      await service.waitUntilReady();
      expect(service.isReady()).toBe(true);
    });

    test("waitUntilReady resolves when model is loaded", async () => {
      await expect(service.waitUntilReady()).resolves.toBeUndefined();
      expect(service.isReady()).toBe(true);
    });

    test("multiple calls to waitUntilReady work correctly", async () => {
      const promise1 = service.waitUntilReady();
      const promise2 = service.waitUntilReady();
      await Promise.all([promise1, promise2]);
      expect(service.isReady()).toBe(true);
    });
  });

  describe("getEmbedding", () => {
    test("generates embedding for text with summary strategy", async () => {
      await service.waitUntilReady();
      const embedding = await service.getEmbedding("skill-name", "Hello, world!");
      
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384); // all-MiniLM-L6-v2 has 384 dimensions
      expect(embedding.length).toBeGreaterThan(0);
    });

    test("generates normalized embeddings", async () => {
      await service.waitUntilReady();
      const embedding = await service.getEmbedding("test-skill", "Test text");
      
      // Check that the embedding is normalized (magnitude should be ~1)
      let magnitude = 0;
      for (let i = 0; i < embedding.length; i++) {
        const val = embedding[i];
        if (val !== undefined) {
          magnitude += val * val;
        }
      }
      magnitude = Math.sqrt(magnitude);
      
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    test("waits for model if not ready", async () => {
      // Don't wait for model to be ready first
      const embedding = await service.getEmbedding("test-skill", "Test without waiting");
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(service.isReady()).toBe(true);
    });

    test("generates different embeddings for different texts", async () => {
      await service.waitUntilReady();
      const embedding1 = await service.getEmbedding("skill1", "Hello");
      const embedding2 = await service.getEmbedding("skill2", "Goodbye");
      
      // Embeddings should be different
      let areSame = true;
      for (let i = 0; i < embedding1.length; i++) {
        if (embedding1[i] !== embedding2[i]) {
          areSame = false;
          break;
        }
      }
      expect(areSame).toBe(false);
    });

    test("generates similar embeddings for similar texts", async () => {
      await service.waitUntilReady();
      const embedding1 = await service.getEmbedding("skill1", "The cat sat on the mat");
      const embedding2 = await service.getEmbedding("skill2", "A cat was sitting on a mat");
      
      const similarity = service.cosineSimilarity(embedding1, embedding2);
      // Similar sentences should have high similarity (> 0.7)
      expect(similarity).toBeGreaterThan(0.7);
    });
  });

  describe("caching", () => {
    test("caches embeddings to disk", async () => {
      await service.waitUntilReady();
      const name = "test-skill";
      const description = "Test caching";
      const text = `${name}: ${description}`;
      const hash = hashContent(text);
      const cachePath = getEmbeddingPath(DEFAULT_MODEL, hash);
      
      // Generate embedding (should write to cache)
      await service.getEmbedding(name, description);
      
      // Check that cache file exists
      const stats = await fs.stat(cachePath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });

    test("retrieves embeddings from cache", async () => {
      await service.waitUntilReady();
      const name = "test-skill";
      const description = "Test cache retrieval";
      
      // Generate embedding first time (cache miss)
      const embedding1 = await service.getEmbedding(name, description);
      
      // Generate same embedding second time (cache hit)
      const embedding2 = await service.getEmbedding(name, description);
      
      // Should be identical
      expect(embedding2.length).toBe(embedding1.length);
      for (let i = 0; i < embedding1.length; i++) {
        expect(embedding2[i]).toBe(embedding1[i]);
      }
    });

    test("cache is consistent across instances", async () => {
      await service.waitUntilReady();
      const name = "test-skill";
      const description = "Cross-instance cache test";
      
      // Generate with first instance
      const embedding1 = await service.getEmbedding(name, description);
      
      // Create new instance and retrieve
      const service2 = new EmbeddingService(DEFAULT_MODEL);
      await service2.waitUntilReady();
      const embedding2 = await service2.getEmbedding(name, description);
      
      // Should be identical from cache
      expect(embedding2.length).toBe(embedding1.length);
      for (let i = 0; i < embedding1.length; i++) {
        expect(embedding2[i]).toBe(embedding1[i]);
      }
    });
  });

  describe("cosineSimilarity", () => {
    test("returns 1.0 for identical vectors", () => {
      const vec = new Float32Array([1, 2, 3, 4, 5]);
      const similarity = service.cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    test("returns 0.0 for orthogonal vectors", () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      const similarity = service.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0.0, 5);
    });

    test("returns -1.0 for opposite vectors", () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([-1, 0, 0]);
      const similarity = service.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    test("calculates correct similarity for arbitrary vectors", () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([4, 5, 6]);
      const similarity = service.cosineSimilarity(vec1, vec2);
      
      // Expected: (1*4 + 2*5 + 3*6) / (sqrt(1+4+9) * sqrt(16+25+36))
      // = 32 / (sqrt(14) * sqrt(77))
      // = 32 / 32.86... ≈ 0.9746
      expect(similarity).toBeCloseTo(0.9746, 3);
    });

    test("throws error for vectors of different lengths", () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([1, 2]);
      expect(() => service.cosineSimilarity(vec1, vec2)).toThrow(
        "Vectors must have the same length",
      );
    });

    test("returns 0 for zero vectors", () => {
      const vec1 = new Float32Array([0, 0, 0]);
      const vec2 = new Float32Array([1, 2, 3]);
      const similarity = service.cosineSimilarity(vec1, vec2);
      expect(similarity).toBe(0);
    });

    test("handles normalized vectors correctly", async () => {
      await service.waitUntilReady();
      const embedding1 = await service.getEmbedding("skill1", "Test 1");
      const embedding2 = await service.getEmbedding("skill2", "Test 2");
      
      const similarity = service.cosineSimilarity(embedding1, embedding2);
      // Similarity should be between -1 and 1
      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe("embedding strategies", () => {
    test("summary strategy embeds name and description", async () => {
      const summaryService = new EmbeddingService(DEFAULT_MODEL, 'summary');
      await summaryService.waitUntilReady();
      
      const name = "test-skill";
      const description = "A test skill";
      const fullContent = "# Test Skill\n\nThis is a very long document with lots of content.";
      
      // With summary strategy, fullContent should be ignored
      const embedding = await summaryService.getEmbedding(name, description, fullContent);
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("full strategy embeds full content when provided", async () => {
      const fullService = new EmbeddingService(DEFAULT_MODEL, 'full');
      await fullService.waitUntilReady();
      
      const name = "test-skill";
      const description = "A test skill";
      const fullContent = "# Test Skill\n\nThis is a very long document with lots of content that should be embedded instead of the summary.";
      
      const embedding = await fullService.getEmbedding(name, description, fullContent);
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("full strategy falls back to summary when no fullContent provided", async () => {
      const fullService = new EmbeddingService(DEFAULT_MODEL, 'full');
      await fullService.waitUntilReady();
      
      const name = "test-skill";
      const description = "A test skill";
      
      const embedding = await fullService.getEmbedding(name, description);
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("different strategies produce different cache entries", async () => {
      const summaryService = new EmbeddingService(DEFAULT_MODEL, 'summary');
      const fullService = new EmbeddingService(DEFAULT_MODEL, 'full');
      await summaryService.waitUntilReady();
      await fullService.waitUntilReady();
      
      const name = "test-skill";
      const description = "Short description";
      const fullContent = "# Test Skill\n\nThis is much longer content that will produce a different embedding.";
      
      const summaryEmbedding = await summaryService.getEmbedding(name, description, fullContent);
      const fullEmbedding = await fullService.getEmbedding(name, description, fullContent);
      
      // Embeddings should be different because they're based on different text
      let areSame = true;
      for (let i = 0; i < summaryEmbedding.length; i++) {
        if (summaryEmbedding[i] !== fullEmbedding[i]) {
          areSame = false;
          break;
        }
      }
      expect(areSame).toBe(false);
      
      // Similarity should be moderate but not identical
      const similarity = summaryService.cosineSimilarity(summaryEmbedding, fullEmbedding);
      expect(similarity).toBeLessThan(0.99); // Not identical
    });
  });

  describe("error handling", () => {
    test("handles empty description gracefully", async () => {
      await service.waitUntilReady();
      const embedding = await service.getEmbedding("skill-name", "");
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("handles very long text", async () => {
      await service.waitUntilReady();
      const longText = "word ".repeat(1000);
      const embedding = await service.getEmbedding("skill-name", longText);
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("handles special characters", async () => {
      await service.waitUntilReady();
      const specialText = "Hello! @#$%^&*() 你好 مرحبا";
      const embedding = await service.getEmbedding("skill-name", specialText);
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
  });
});
