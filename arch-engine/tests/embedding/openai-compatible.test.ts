import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import {
  embedQuery,
  embedTexts,
} from "../../src/embedding/openai-compatible.js";

function mockEmbeddingResponse(embeddings: number[][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: embeddings.map((embedding, index) => ({ embedding, index })),
    }),
  };
}

describe("openai-compatible embedding", () => {
  const envName = DEFAULT_CONFIG.embedding.apiKeyEnv;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env[envName] = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete process.env[envName];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("embedTexts returns embeddings sorted by index", async () => {
    fetchMock.mockResolvedValueOnce(
      mockEmbeddingResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ])
    );

    const result = await embedTexts(DEFAULT_CONFIG, ["a", "b"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_CONFIG.embedding.baseUrl}/embeddings`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
        body: JSON.stringify({
          model: DEFAULT_CONFIG.embedding.model,
          input: ["a", "b"],
        }),
      })
    );
  });

  it("embedTexts batches requests in groups of 10 for DashScope", async () => {
    const dashConfig = {
      ...DEFAULT_CONFIG,
      embedding: {
        ...DEFAULT_CONFIG.embedding,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "text-embedding-v3",
      },
    };
    const texts = Array.from({ length: 11 }, (_, i) => `text-${i}`);
    fetchMock
      .mockResolvedValueOnce(
        mockEmbeddingResponse(Array.from({ length: 10 }, () => [1, 0]))
      )
      .mockResolvedValueOnce(mockEmbeddingResponse([[2, 0]]));

    const result = await embedTexts(dashConfig, texts);

    expect(result).toHaveLength(11);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toHaveLength(10);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toHaveLength(1);
  });

  it("embedTexts respects explicit embedding.batchSize override", async () => {
    const customConfig = {
      ...DEFAULT_CONFIG,
      embedding: { ...DEFAULT_CONFIG.embedding, batchSize: 3 },
    };
    const texts = ["a", "b", "c", "d"];
    fetchMock
      .mockResolvedValueOnce(mockEmbeddingResponse([[1], [2], [3]]))
      .mockResolvedValueOnce(mockEmbeddingResponse([[4]]));

    await embedTexts(customConfig, texts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toHaveLength(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toHaveLength(1);
  });

  it("embedTexts batches requests in groups of 64", async () => {
    const texts = Array.from({ length: 65 }, (_, i) => `text-${i}`);
    fetchMock
      .mockResolvedValueOnce(
        mockEmbeddingResponse(
          Array.from({ length: 64 }, () => [1, 0])
        )
      )
      .mockResolvedValueOnce(mockEmbeddingResponse([[2, 0]]));

    const result = await embedTexts(DEFAULT_CONFIG, texts);

    expect(result).toHaveLength(65);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toHaveLength(64);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toHaveLength(1);
  });

  it("embedTexts returns empty array for no input", async () => {
    const result = await embedTexts(DEFAULT_CONFIG, []);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries on 429 with exponential backoff then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "rate limited",
      })
      .mockResolvedValueOnce(mockEmbeddingResponse([[0.5]]));

    const promise = embedTexts(DEFAULT_CONFIG, ["retry-me"]);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toEqual([[0.5]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx with exponential backoff then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "503",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: async () => "502",
      })
      .mockResolvedValueOnce(mockEmbeddingResponse([[0.9]]));

    const promise = embedTexts(DEFAULT_CONFIG, ["server-error"]);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toEqual([[0.9]]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries on 429", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    });

    const promise = embedTexts(DEFAULT_CONFIG, ["fail"]);
    const assertion = expect(promise).rejects.toThrow("Embedding failed: 429");

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry on non-retryable 4xx errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid key",
    });

    await expect(embedTexts(DEFAULT_CONFIG, ["unauthorized"])).rejects.toThrow(
      "Embedding failed: 401"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("embedQuery returns a single embedding via embedTexts", async () => {
    fetchMock.mockResolvedValueOnce(mockEmbeddingResponse([[0.7, 0.8]]));

    const result = await embedQuery(DEFAULT_CONFIG, "query text");

    expect(result).toEqual([0.7, 0.8]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toEqual([
      "query text",
    ]);
  });
});
