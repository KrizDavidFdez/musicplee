/**
 * Ultra-fast parallel multi-chunk downloader (8 concurrent chunks / Range requests).
 * Bypasses per-connection bandwidth throttling by segmenting large audio files
 * into 8 parallel ranges and concatenating them in memory.
 */
const CHUNK_TIMEOUT_MS = 12000;
const CHUNK_MAX_RETRIES = 2;

async function fetchChunkWithRetry(
  url: string,
  start: number,
  end: number,
  index: number
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt++) {
    const chunkController = new AbortController();
    const chunkTimeout = setTimeout(() => chunkController.abort(), CHUNK_TIMEOUT_MS);
    try {
      const chunkRes = await fetch(url, {
        headers: {
          'Range': `bytes=${start}-${end}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
        signal: chunkController.signal,
      });
      clearTimeout(chunkTimeout);

      if (chunkRes.status === 206 || chunkRes.status === 200) {
        const arrayBuf = await chunkRes.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
      throw new Error(`Range chunk ${index} failed with status: ${chunkRes.status}`);
    } catch (err) {
      clearTimeout(chunkTimeout);
      lastErr = err;
      // brief backoff before retrying this chunk only
      if (attempt < CHUNK_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Chunk ${index} failed`);
}

export async function downloadFast8Chunks(url: string, concurrency: number = 8): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    // 1. Probe Content-Length & Accept-Ranges via HEAD request
    let totalBytes = 0;
    let supportsRange = true;

    try {
      const headRes = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
        signal: controller.signal,
      });

      const cl = headRes.headers.get('content-length');
      if (cl) {
        totalBytes = parseInt(cl, 10);
      }
      const acceptRanges = headRes.headers.get('accept-ranges');
      if (acceptRanges === 'none') {
        supportsRange = false;
      }
    } catch {
      // Ignore head request failures and attempt direct/range fallback
    }

    // 2. If content-length is known and large enough (>128 KB), launch 8 parallel chunk requests
    if (totalBytes > 128 * 1024 && supportsRange) {
      const numChunks = Math.min(concurrency, 8);
      const chunkSize = Math.ceil(totalBytes / numChunks);
      const chunkPromises: Promise<Buffer>[] = [];

      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, totalBytes - 1);
        if (start > end) break;

        chunkPromises.push(fetchChunkWithRetry(url, start, end, i));
      }

      try {
        const chunkBuffers = await Promise.all(chunkPromises);
        clearTimeout(timeout);
        const concatenated = Buffer.concat(chunkBuffers);
        if (concatenated.length > 0) {
          return concatenated;
        }
      } catch (chunkErr) {
        console.warn('8-chunk parallel download error, falling back to full buffer fetch:', chunkErr);
      }
    }

    // 3. Fallback: Fast single-request full buffer download
    const fullRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!fullRes.ok) {
      throw new Error(`Failed to fetch media from ${url}, status: ${fullRes.status}`);
    }

    const arrayBuf = await fullRes.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
