/**
 * Fast downloader with optional parallel chunks.
 * Keeps the original function names.
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

    const chunkTimeout = setTimeout(
      () => chunkController.abort(),
      CHUNK_TIMEOUT_MS
    );

    try {
      const chunkRes = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: '*/*'
        },
        signal: chunkController.signal
      });

      clearTimeout(chunkTimeout);

      /*
       * 206 = servidor soporta Range correctamente.
       *
       * 200 NO se acepta aquí porque significa que el servidor
       * ignoró el Range y devolvió probablemente el archivo completo.
       */
      if (chunkRes.status !== 206) {
        throw new Error(
          `Range chunk ${index} failed with status: ${chunkRes.status}`
        );
      }

      const arrayBuf = await chunkRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (!buffer.length) {
        throw new Error(`Range chunk ${index} returned an empty buffer`);
      }

      return buffer;
    } catch (err) {
      clearTimeout(chunkTimeout);
      lastErr = err;

      if (attempt < CHUNK_MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1))
        );
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Chunk ${index} failed`);
}

export async function downloadFast8Chunks(
  url: string,
  concurrency: number = 8
): Promise<Buffer> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 25000);

  try {
    let totalBytes = 0;
    let supportsRange = false;

    /*
     * Primero intentamos obtener Content-Length.
     * Si HEAD no funciona, hacemos una petición Range pequeña.
     */
    try {
      const headRes = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: '*/*'
        },
        signal: controller.signal
      });

      const cl = headRes.headers.get('content-length');

      if (cl) {
        totalBytes = parseInt(cl, 10);
      }

      const acceptRanges = headRes.headers.get('accept-ranges');

      if (acceptRanges === 'bytes') {
        supportsRange = true;
      }
    } catch {
      // HEAD no soportado, continuamos con Range.
    }

    /*
     * Si HEAD no nos confirmó Range, hacemos una prueba real.
     */
    if (!supportsRange || !totalBytes) {
      try {
        const probeController = new AbortController();

        const probeTimeout = setTimeout(() => {
          probeController.abort();
        }, 8000);

        const probeRes = await fetch(url, {
          headers: {
            Range: 'bytes=0-0',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: '*/*'
          },
          signal: probeController.signal
        });

        clearTimeout(probeTimeout);

        if (probeRes.status === 206) {
          supportsRange = true;

          const contentRange = probeRes.headers.get('content-range');

          /*
           * Ejemplo:
           * bytes 0-0/52428800
           */
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)$/);

            if (match) {
              totalBytes = parseInt(match[1], 10);
            }
          }
        }
      } catch {
        // Range no disponible.
      }
    }

    /*
     * Usamos chunks únicamente cuando sabemos el tamaño
     * y el servidor confirmó Range.
     */
    if (
      supportsRange &&
      totalBytes > 128 * 1024
    ) {
      const numChunks = Math.max(
        1,
        Math.min(Number(concurrency) || 8, 8)
      );

      const chunkSize = Math.ceil(totalBytes / numChunks);

      const chunkPromises: Promise<Buffer>[] = [];

      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(
          start + chunkSize - 1,
          totalBytes - 1
        );

        if (start > end) {
          break;
        }

        chunkPromises.push(
          fetchChunkWithRetry(
            url,
            start,
            end,
            i
          )
        );
      }

      try {
        const chunkBuffers = await Promise.all(
          chunkPromises
        );

        const result = Buffer.concat(chunkBuffers);

        /*
         * Verificación importante:
         * si faltan bytes, NO devolvemos un archivo corrupto.
         */
        if (
          result.length === totalBytes
        ) {
          clearTimeout(timeout);
          return result;
        }

        console.warn(
          `Chunk download incomplete: ${result.length}/${totalBytes} bytes`
        );
      } catch (chunkErr) {
        console.warn(
          'Parallel chunk download failed, using normal download:',
          chunkErr
        );
      }
    }

    /*
     * Fallback normal.
     * Esta parte funciona incluso cuando el servidor/CDN
     * no permite Range requests.
     */
    const fullRes = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!fullRes.ok) {
      throw new Error(
        `Failed to fetch media from ${url}, status: ${fullRes.status}`
      );
    }

    const arrayBuf = await fullRes.arrayBuffer();

    return Buffer.from(arrayBuf);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
