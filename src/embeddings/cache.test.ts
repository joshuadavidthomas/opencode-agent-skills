import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  hashContent,
  readCachedEmbedding,
  writeCachedEmbedding,
} from "./cache";

describe("cache", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("hashContent", () => {
    test("generates consistent SHA-256 hash", () => {
      const text = "Hello, world!";
      const hash1 = hashContent(text);
      const hash2 = hashContent(text);

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(
        "315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3",
      );
    });

    test("generates different hashes for different content", () => {
      const hash1 = hashContent("foo");
      const hash2 = hashContent("bar");

      expect(hash1).not.toBe(hash2);
    });

    test("returns 64-character hex string", () => {
      const hash = hashContent("test");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("writeCachedEmbedding", () => {
    test("writes Float32Array to disk", async () => {
      const embedding = new Float32Array([1.5, 2.5, 3.5]);
      const filePath = path.join(tempDir, "test.bin");

      await writeCachedEmbedding(filePath, embedding);

      const exists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test("creates parent directories if needed", async () => {
      const embedding = new Float32Array([1.0, 2.0]);
      const filePath = path.join(tempDir, "nested", "dir", "test.bin");

      await writeCachedEmbedding(filePath, embedding);

      const exists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    test("writes correct binary data", async () => {
      const embedding = new Float32Array([1.5, 2.5, 3.5]);
      const filePath = path.join(tempDir, "test.bin");

      await writeCachedEmbedding(filePath, embedding);

      const buffer = await fs.readFile(filePath);
      expect(buffer.length).toBe(12); // 3 floats * 4 bytes
    });
  });

  describe("readCachedEmbedding", () => {
    test("reads Float32Array from disk", async () => {
      const original = new Float32Array([1.5, 2.5, 3.5]);
      const filePath = path.join(tempDir, "test.bin");

      await writeCachedEmbedding(filePath, original);
      const result = await readCachedEmbedding(filePath);

      expect(result).not.toBeNull();
      expect(result?.length).toBe(3);
      expect(Array.from(result ?? [])).toEqual([1.5, 2.5, 3.5]);
    });

    test("returns null for non-existent file", async () => {
      const filePath = path.join(tempDir, "nonexistent.bin");
      const result = await readCachedEmbedding(filePath);

      expect(result).toBeNull();
    });

    test("round-trip preserves data", async () => {
      const original = new Float32Array([
        0.1, -0.5, 3.14159, 2.71828, 0.0, -1.0,
      ]);
      const filePath = path.join(tempDir, "test.bin");

      await writeCachedEmbedding(filePath, original);
      const result = await readCachedEmbedding(filePath);

      expect(result).not.toBeNull();
      expect(result?.length).toBe(original.length);

      // Check each value
      for (let i = 0; i < original.length; i++) {
        expect(result?.[i]).toBeCloseTo(original[i] ?? 0, 6);
      }
    });
  });

  describe("integration", () => {
    test("full workflow: hash, write, read", async () => {
      const text = "This is a test document";
      const hash = hashContent(text);
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      const filePath = path.join(tempDir, `${hash}.bin`);

      // Write
      await writeCachedEmbedding(filePath, embedding);

      // Read back
      const cached = await readCachedEmbedding(filePath);

      expect(cached).not.toBeNull();
      expect(cached?.length).toBe(5);

      // Check each value with floating-point tolerance
      const expected = [0.1, 0.2, 0.3, 0.4, 0.5];
      for (let i = 0; i < expected.length; i++) {
        expect(cached?.[i]).toBeCloseTo(expected[i] ?? 0, 6);
      }
    });
  });
});
