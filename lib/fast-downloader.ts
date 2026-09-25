const CHUNK_TIMEOUT_MS = 12000;
const CHUNK_MAX_RETRIES = 2;

export async function downloadFast8Chunks(
  url: string,
  concurrency: number = 8
): Promise<Buffer> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 60000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch media from ${url}, status: ${response.status}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();

    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}
