import { describe, test, expect } from "bun:test";
import { levenshtein, findClosestMatch } from "./utils";

describe("levenshtein", () => {
  test("identical strings have distance 0", async () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  test("completely different strings have high distance", async () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  test("single character difference", async () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  test("insertion", async () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  test("deletion", async () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  test("substitution", async () => {
    expect(levenshtein("cat", "cut")).toBe(1);
  });

  test("case sensitive", async () => {
    expect(levenshtein("Cat", "cat")).toBe(1);
  });
});

describe("findClosestMatch", () => {
  test("returns null for empty candidate list", async () => {
    expect(findClosestMatch("test", [])).toBe(null);
  });

  test("exact match returns the match", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf");
  });

  test("prefix match - user types partial skill name", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("prefix match - longer match", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("brainstorming");
  });

  test("typo correction via Levenshtein", async () => {
    const candidates = ["pattern", "git-helper", "pdf"];
    expect(findClosestMatch("patern", candidates)).toBe("pattern");
  });

  test("case insensitive matching", async () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("Brainstorming");
  });

  test("case insensitive exact match", async () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("PDF", candidates)).toBe("PDF");
  });

  test("substring match", async () => {
    const candidates = ["document-processor", "git-helper", "pdf-reader"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("no close matches below threshold returns null", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("xyzabc", candidates)).toBe(null);
  });

  test("multiple similar candidates returns best match", async () => {
    const candidates = ["test", "testing", "tests"];
    // "test" should win because it's an exact match
    expect(findClosestMatch("test", candidates)).toBe("test");
  });

  test("prefix matching beats substring matching", async () => {
    const candidates = ["pdf-reader", "reader-pdf"];
    // "pdf-reader" starts with "pdf", "reader-pdf" only contains it
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("handles hyphenated names", async () => {
    const candidates = ["git-helper", "github-actions", "gitlab-ci"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("script path matching", async () => {
    const candidates = ["build.sh", "scripts/deploy.sh", "tools/build.sh"];
    expect(findClosestMatch("deploy", candidates)).toBe("scripts/deploy.sh");
  });

  test("typo in script name", async () => {
    const candidates = ["build.sh", "deploy.sh", "test.sh"];
    expect(findClosestMatch("biuld.sh", candidates)).toBe("build.sh");
  });
});
