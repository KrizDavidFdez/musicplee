// Descarga completa del audio a memoria (Blob) ANTES de reproducir.
// Asi el <audio> siempre recibe un archivo local valido y nunca se queda
// colgado esperando un stream remoto que falla o caduca.

export class AudioDownloadError extends Error {}
export class AudioDownloadAborted extends Error {}

interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

// Cache de blobs ya descargados (la siguiente vez suena al instante)
const blobCache = new Map<string, string>();
const MAX_CACHED = 8;

export function getCachedBlobUrl(key: string): string | undefined {
  return blobCache.get(key);
}

function rememberBlob(key: string, url: string) {
  blobCache.set(key, url);
  while (blobCache.size > MAX_CACHED) {
    const oldest = blobCache.keys().next().value as string;
    const oldUrl = blobCache.get(oldest);
    blobCache.delete(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
}

// Baja el archivo completo y devuelve un blob: URL listo para <audio src>
export async function downloadAudioToBlobUrl(
  remoteUrl: string,
  cacheKey: string,
  { signal, onProgress }: DownloadOptions = {}
): Promise<string> {
  const cached = blobCache.get(cacheKey);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(remoteUrl, { signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AudioDownloadAborted();
    throw new AudioDownloadError('No se pudo conectar para descargar el audio');
  }

  if (!res.ok || !res.body) {
    throw new AudioDownloadError(`El servidor respondio ${res.status}`);
  }

  const ctype = res.headers.get('content-type') || '';
  if (ctype.includes('text/') || ctype.includes('json')) {
    throw new AudioDownloadError('El servidor devolvio una pagina en lugar de audio');
  }

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (total > 0 && onProgress) onProgress(Math.min(received / total, 1));
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AudioDownloadAborted();
    throw new AudioDownloadError('Se corto la descarga del audio');
  }

  // Un mp3 real de una cancion pesa mucho mas que esto; menos = error/respuesta vacia
  if (received < 50_000) {
    throw new AudioDownloadError('El audio descargado esta incompleto');
  }
  // Si el servidor anuncio un tamano y llego menos, la descarga se corto
  if (total > 0 && received < total) {
    throw new AudioDownloadError('El audio se descargo incompleto');
  }

  const type = ctype.startsWith('audio/') ? ctype.split(';')[0] : 'audio/mpeg';
  const blob = new Blob(chunks as BlobPart[], { type });
  const blobUrl = URL.createObjectURL(blob);
  rememberBlob(cacheKey, blobUrl);
  return blobUrl;
}
