# Embedding Service

A high-performance embedding service with local caching for semantic search and similarity operations.

## Overview

The embedding service provides:
- **Model Management**: Asynchronous model loading with ready state tracking
- **Smart Caching**: Content-addressed caching of embeddings to disk
- **Similarity Search**: Cosine similarity computation between vectors
- **Multiple Models**: Support for various Hugging Face transformer models

## Usage

```typescript
import { EmbeddingService } from "./embeddings/service";

// Create service (model loads in background)
const service = new EmbeddingService("all-MiniLM-L6-v2");

// Wait for model to be ready
await service.waitUntilReady();

// Generate embeddings with summary strategy (default)
const embedding1 = await service.getEmbedding("skill-name", "A description of the skill");
const embedding2 = await service.getEmbedding("other-skill", "Another skill description");

// Compute similarity
const similarity = service.cosineSimilarity(embedding1, embedding2);
console.log(`Similarity: ${similarity.toFixed(3)}`); // 0.850
```

### Embedding Strategies

The service supports two embedding strategies:

#### Summary Strategy (Default)

Embeds just the name and description as `"${name}: ${description}"`. This is faster and more focused on the skill's core purpose.

```typescript
const service = new EmbeddingService("all-MiniLM-L6-v2", 'summary');
await service.waitUntilReady();

const embedding = await service.getEmbedding(
  "git-helper",
  "Provides git workflow assistance and commit message optimization"
);
```

#### Full Strategy

Embeds the entire SKILL.md content when provided. This captures more context but requires more processing time. Falls back to summary if no full content is provided.

```typescript
const service = new EmbeddingService("all-MiniLM-L6-v2", 'full');
await service.waitUntilReady();

const skillContent = await fs.readFile("SKILL.md", "utf-8");
const embedding = await service.getEmbedding(
  "git-helper",
  "Provides git workflow assistance and commit message optimization",
  skillContent
);
```

## Architecture

### Files

- **service.ts**: Main `EmbeddingService` class with model management and embedding generation
- **cache.ts**: Content-addressed caching utilities (hash, read, write)
- **models.ts**: Model configuration registry with supported Hugging Face models
- **paths.ts**: XDG-compliant cache directory resolution

### Caching Strategy

Embeddings are cached using SHA-256 hashes of input text:
```
~/.cache/opencode-agent-skills/embeddings/{model-name}/{content-hash}.bin
```

This provides:
- **Deduplication**: Identical text generates same hash
- **Cross-session**: Cache persists across program restarts
- **Fast retrieval**: Binary format for quick loading

## Available Models

| Model | Dimensions | Max Tokens | Use Case |
|-------|------------|------------|----------|
| `paraphrase-MiniLM-L3-v2` | 384 | 128 | Fast, general purpose |
| `all-MiniLM-L6-v2` | 384 | 256 | **Default** - balanced speed/accuracy |
| `all-MiniLM-L12-v2` | 384 | 256 | Higher accuracy |
| `all-mpnet-base-v2` | 768 | 384 | Best accuracy, slower |
| `bge-small-en-v1.5` | 384 | 512 | Long documents |

## System Dependencies

The service requires:
- **Node.js 18+** or **Bun 1.0+**
- **onnxruntime-node**: Install with `bun add onnxruntime-node`

## Testing

The test suite covers:
- Model initialization and ready state
- Embedding generation and normalization
- Cache hit/miss scenarios
- Cosine similarity calculations
- Error handling (empty text, long text, special characters)

Run tests:
```bash
bun test src/embeddings/service.test.ts
```

## Performance

Typical performance (all-MiniLM-L6-v2 on CPU):
- **Cold start**: ~500ms (model loading)
- **First embedding**: ~50ms (generation + cache write)
- **Cached embedding**: ~1ms (disk read)
- **Similarity computation**: ~0.1ms (384 dimensions)

## API Reference

### `EmbeddingService`

#### Constructor
```typescript
constructor(
  modelName: string = DEFAULT_MODEL,
  strategy: EmbeddingStrategy = 'summary'
)
```

Creates a new service instance. Model loading begins immediately in the background.

**Parameters**:
- `modelName`: Name of the Hugging Face model to use
- `strategy`: Embedding strategy - `'summary'` (name+description) or `'full'` (entire SKILL.md content)

**Throws**: Error if model name is not recognized

#### `isReady(): boolean`

Synchronous check if the model is loaded and ready.

#### `waitUntilReady(): Promise<void>`

Waits until the model is loaded.

**Throws**: Error if model loading failed

#### `getEmbedding(name: string, description: string, fullContent?: string): Promise<Float32Array>`

Generates an embedding for the given skill with caching.

**Parameters**:
- `name`: The skill name
- `description`: The skill description
- `fullContent`: Optional full SKILL.md content (used with 'full' strategy)

**Returns**: Float32Array of embeddings (normalized, pooled)

**Throws**: Error if model is not loaded or generation fails

**Note**: Cache keys are based on the actual text being embedded, so different strategies will have separate cache entries.

#### `cosineSimilarity(a: Float32Array, b: Float32Array): number`

Computes cosine similarity between two embedding vectors.

**Returns**: Number between -1 and 1 (higher = more similar)

**Throws**: Error if vectors have different lengths

## Examples

### Batch Processing

```typescript
const service = new EmbeddingService();
await service.waitUntilReady();

const skills = [
  { name: "git-helper", description: "Git workflow assistance" },
  { name: "test-skill", description: "Testing utilities" },
  { name: "docs-skill", description: "Documentation tools" }
];

const embeddings = await Promise.all(
  skills.map(skill => service.getEmbedding(skill.name, skill.description))
);
```

### Semantic Search with Summary Strategy

```typescript
const service = new EmbeddingService("all-MiniLM-L6-v2", 'summary');
await service.waitUntilReady();

const queryEmbedding = await service.getEmbedding(
  "search-query",
  "machine learning algorithms"
);

const skills = [
  { name: "neural-net", description: "Introduction to neural networks" },
  { name: "cooking", description: "Cooking recipes for beginners" },
  { name: "tensorflow", description: "Deep learning with TensorFlow" }
];

const results = await Promise.all(
  skills.map(async (skill) => {
    const embedding = await service.getEmbedding(skill.name, skill.description);
    const similarity = service.cosineSimilarity(queryEmbedding, embedding);
    return { skill, similarity };
  })
);

results.sort((a, b) => b.similarity - a.similarity);
console.log("Most relevant:", results[0].skill.name);
```

### Comparing Strategies

```typescript
const summaryService = new EmbeddingService("all-MiniLM-L6-v2", 'summary');
const fullService = new EmbeddingService("all-MiniLM-L6-v2", 'full');

await Promise.all([summaryService.waitUntilReady(), fullService.waitUntilReady()]);

const skillName = "git-helper";
const skillDescription = "Git workflow assistance";
const skillContent = await fs.readFile("skills/git-helper/SKILL.md", "utf-8");

// Fast: embeds just "git-helper: Git workflow assistance"
const summaryEmbedding = await summaryService.getEmbedding(
  skillName,
  skillDescription
);

// Thorough: embeds entire SKILL.md content
const fullEmbedding = await fullService.getEmbedding(
  skillName,
  skillDescription,
  skillContent
);

console.log("Summary captures core concept, full captures detailed context");
```

### Using Different Models

```typescript
// Fast model for quick prototyping
const fastService = new EmbeddingService("paraphrase-MiniLM-L3-v2", 'summary');

// Accurate model for production
const accurateService = new EmbeddingService("all-mpnet-base-v2", 'full');

// Long document model
const longDocService = new EmbeddingService("bge-small-en-v1.5", 'full');
```

## Notes

- Embeddings are normalized (magnitude = 1.0)
- Mean pooling is used to aggregate token embeddings
- Cache files are binary Float32Array format
- Model downloads from Hugging Face on first use (~20-100MB depending on model)
