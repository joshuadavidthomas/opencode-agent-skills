import { describe, expect, test } from "bun:test";
import { getEmbedding, cosineSimilarity } from "./embeddings";

describe("embeddings", () => {
  describe("getEmbedding", () => {
    test("generates 384-dimensional embedding", async () => {
      const embedding = await getEmbedding("test-skill", "A test description");
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test("generates normalized embeddings", async () => {
      const embedding = await getEmbedding("test", "normalized vector");
      let magnitude = 0;
      for (let i = 0; i < embedding.length; i++) {
        const val = embedding[i];
        if (val !== undefined) {
          magnitude += val * val;
        }
      }
      expect(Math.sqrt(magnitude)).toBeCloseTo(1.0, 5);
    });

    test("caches results", async () => {
      const name = "cache-test";
      const desc = "Test caching behavior";
      const embedding1 = await getEmbedding(name, desc);
      const embedding2 = await getEmbedding(name, desc);

      // Should be identical (from cache)
      expect(embedding2.length).toBe(embedding1.length);
      for (let i = 0; i < embedding1.length; i++) {
        expect(embedding2[i]).toBe(embedding1[i]);
      }
    });

    test("generates different embeddings for different inputs", async () => {
      const embedding1 = await getEmbedding("skill1", "First description");
      const embedding2 = await getEmbedding("skill2", "Different description");

      let areSame = true;
      for (let i = 0; i < embedding1.length; i++) {
        if (embedding1[i] !== embedding2[i]) {
          areSame = false;
          break;
        }
      }
      expect(areSame).toBe(false);
    });
  });

  describe("cosineSimilarity", () => {
    test("returns 1.0 for identical vectors", () => {
      const vec = new Float32Array([1, 2, 3, 4, 5]);
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
    });

    test("returns 0.0 for orthogonal vectors", () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.0, 5);
    });

    test("returns -1.0 for opposite vectors", () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1.0, 5);
    });

    test("calculates correct similarity for arbitrary vectors", () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([4, 5, 6]);
      // (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77)) ≈ 0.9746
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.9746, 3);
    });

    test("throws error for mismatched vector lengths", () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([1, 2]);
      expect(() => cosineSimilarity(vec1, vec2)).toThrow("same length");
    });

    test("returns 0 for zero vectors", () => {
      const vec1 = new Float32Array([0, 0, 0]);
      const vec2 = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(vec1, vec2)).toBe(0);
    });

    test("works with real embeddings", async () => {
      const embedding1 = await getEmbedding("skill1", "The cat sat on the mat");
      const embedding2 = await getEmbedding("skill2", "A cat was sitting on a mat");
      const similarity = cosineSimilarity(embedding1, embedding2);

      // Similar sentences should have high similarity
      expect(similarity).toBeGreaterThan(0.7);
      expect(similarity).toBeLessThanOrEqual(1.0);
    });
  });
});
