# Embedding Model Analysis

## Executive Summary

**Winner**: `all-MiniLM-L6-v2` 

- 100% accuracy on test queries
- 22.8 MB model size
- ~80ms latency per query
- Best efficiency score (6.5) and size-aware efficiency (1.37)

## Methodology

### Test Suite
- 9 diverse test queries covering:
  - Git operations
  - Document formats (pdf, docx, xlsx, pptx)
  - Frontend/prototyping
  - Writing/documentation
  - Code analysis

### Models Evaluated
Five embedding models were tested with q8 quantization:

| Model | Size (MB) | Dimensions | Max Tokens |
|-------|-----------|------------|------------|
| paraphrase-MiniLM-L3-v2 | 17.4 | 384 | 128 |
| all-MiniLM-L6-v2 | 22.8 | 384 | 256 |
| all-MiniLM-L12-v2 | 33.8 | 384 | 256 |
| bge-small-en-v1.5 | 33.8 | 384 | 512 |
| all-mpnet-base-v2 | 110 | 768 | 384 |

### Metrics
- **Accuracy**: Percentage of test queries matching expected skill
- **Avg Score**: Mean cosine similarity for top matches
- **Avg Latency**: Mean query processing time
- **Score Gap**: Separation between #1 and #2 matches (higher = more decisive)
- **Efficiency**: `(Avg Score × Accuracy) / Avg Latency × 1000`
- **Size-Aware Efficiency**: `Efficiency / √(Size in MB)` - penalizes larger models

## Results

### Performance Summary

| Model | Accuracy | Avg Latency | Size | Efficiency | Size-Aware |
|-------|----------|-------------|------|------------|------------|
| **all-MiniLM-L6-v2** | **100.0%** | **78ms** | **22.8MB** | **6.53** | **1.37** |
| paraphrase-MiniLM-L3-v2 | 66.7% | 67ms | 17.4MB | 5.27 | 1.26 |
| bge-small-en-v1.5 | 88.9% | 120ms | 33.8MB | 5.00 | 0.86 |
| all-MiniLM-L12-v2 | 100.0% | 123ms | 33.8MB | 3.73 | 0.64 |
| all-mpnet-base-v2 | 88.9% | 230ms | 110MB | 1.82 | 0.17 |

### Key Findings

1. **all-MiniLM-L6-v2 dominates**: Wins on both raw efficiency and size-aware efficiency
2. **Perfect accuracy**: L6 and L12 both achieve 100% accuracy, but L6 is faster
3. **Size matters**: L3 is smaller but sacrifices 33% accuracy
4. **Larger ≠ Better**: mpnet-base-v2 (110MB) performs worse than L6 (22.8MB)
5. **Sweet spot**: L6 hits the optimal balance of size, speed, and accuracy

### Failure Analysis

**paraphrase-MiniLM-L3-v2 failures (3/9)**:
- "write documentation for my API" → matched `frontend-design` instead of docs skills
- "create an MCP server for GitHub" → matched `git-helper` instead of `mcp-builder`
- "review my pull request" → matched `git-helper` instead of `reviewing-changes`

**bge-small-en-v1.5 failures (1/9)**:
- "review my pull request" → matched `git-helper` instead of `reviewing-changes`

**all-mpnet-base-v2 failures (1/9)**:
- "create an MCP server for GitHub" → matched `git-helper` instead of `mcp-builder`

## Decision Factors

### Why not L3?
- 33% lower accuracy is unacceptable
- Size savings (4.4MB) doesn't justify accuracy loss
- Failed on critical queries (MCP, docs, PR review)

### Why not L12?
- Same accuracy as L6 but 58% slower (123ms vs 78ms)
- 48% larger (33.8MB vs 22.8MB)
- No accuracy benefit to justify the cost

### Why not bge-small-en-v1.5?
- Higher scores but 11% lower accuracy
- 54% slower than L6
- Larger model size with no clear benefit

### Why not mpnet-base-v2?
- Nearly 5x larger (110MB vs 22.8MB)
- 3x slower (230ms vs 78ms)
- Lower accuracy than L6

## Recommendation

**Use `all-MiniLM-L6-v2` as the default model.**

Rationale:
- Proven 100% accuracy on diverse test cases
- Fast enough for real-time skill matching (<100ms)
- Small enough for plugin distribution (23MB)
- Best overall efficiency considering size, speed, and accuracy
- Well-balanced token limit (256) for skill descriptions

## Threshold Analysis

Current threshold: **0.30**

Score distribution from test queries:
- Correct matches: 0.39 - 0.65
- Incorrect matches: typically < 0.30
- Meta-conversations: typically < 0.25

The 0.30 threshold provides good separation between relevant and irrelevant queries.

## Future Work

1. **Threshold validation**: Run `check-threshold.ts` to validate 0.30 is optimal
2. **Edge case testing**: Run `test-edge-cases.ts` for comprehensive edge case coverage
3. **Strategy comparison**: Test 'full' strategy (entire SKILL.md) vs current 'summary' (name+desc)
4. **Cache analysis**: Measure cache hit rates and disk usage in production
5. **Latency optimization**: Profile embedding computation for potential speedups

## Reproduction

```bash
# Run full model comparison
bun run check-scores.ts

# Test specific threshold values
bun run check-threshold.ts

# Test edge cases
bun run test-edge-cases.ts

# Quick model comparison
bun run compare-models.ts "your query here"
```

## References

- Model cards on Hugging Face: `Xenova/<model-name>`
- Transformers.js documentation: https://huggingface.co/docs/transformers.js
- ONNX quantization details: https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
