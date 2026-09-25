import type { Request, Response } from 'express';
import axios from 'axios';
import { scrapeYoutubeToMp3 } from '../lib/y2jar-scraper';
import { resolvePreview, YouTubeplay } from '../lib/youtubei-player';

// In-memory cache for resolved audio links
const audioCache = new Map<string, any>();
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

let ytdlModule: any = null;
let ytSearchModule: any = null;

async function getYTDL() {
  if (ytdlModule) return ytdlModule;
  try {
    const mod: any = await import('iguro-ytdl');
    ytdlModule = mod.default || mod;
    return ytdlModule;
  } catch (e) {
    console.error('Failed to import iguro-ytdl:', e);
    return null;
  }
}

async function getYTSearch() {
  if (ytSearchModule) return ytSearchModule;
  try {
    const mod: any = await import('yt-search');
    ytSearchModule = mod.default || mod;
    return ytSearchModule;
  } catch (e) {
    console.error('Failed to import yt-search:', e);
    return null;
  }
}

// Convert "3:45", "03:45", or seconds into numeric seconds
function parseDurationSec(dur: any): number {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur;
  if (typeof dur === 'string') {
    const parts = dur.split(':').map((p) => Number(p.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const parsed = Number(dur);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Formulate clean studio search query
function cleanAudioQuery(q: string): string {
  let cleaned = q
    .replace(/official\s*(music)?\s*video/gi, '')
    .replace(/video\s*oficial/gi, '')
    .replace(/official\s*audio/gi, '')
    .replace(/official/gi, '')
    .replace(/video/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

// Stream proxy helper with range support
async function streamAudioUrl(req: Request, res: Response, targetUrl: string, fallbackUrl?: string) {
  const isDownload = req.query?.download === 'true';
  const filename = (req.query?.name as string) || 'track.mp3';

  async function tryStream(urlToStream: string): Promise<boolean> {
    const forwardHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (urlToStream.includes('y2jar') || urlToStream.includes('y2dl')) {
      forwardHeaders['Referer'] = 'https://v2.y2jar.cc/';
    } else if (urlToStream.includes('scriptmind')) {
      forwardHeaders['Referer'] = 'https://scriptmind.co/';
    }

    if (req.headers.range) {
      forwardHeaders['Range'] = req.headers.range as string;
    }

    // Hasta 2 intentos por URL: los tuneles/convertidores fallan a veces en el primer golpe
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await axios.get(urlToStream, {
          headers: forwardHeaders,
          responseType: 'stream',
          timeout: 25000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400,
        });

        const cType = String(resp.headers['content-type'] || '');
        // If server returned plain text, json or html error page instead of media
        if (cType.includes('text/') || cType.includes('json')) {
          resp.data.destroy();
          continue;
        }

        res.status(resp.status);
        // Forzamos un tipo de audio valido: application/octet-stream hace que algunos navegadores no reproduzcan
        const safeType =
          cType.startsWith('audio/') || cType.startsWith('video/') ? cType : 'audio/mpeg';
        res.setHeader('Content-Type', safeType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (resp.headers['content-length']) {
          res.setHeader('Content-Length', String(resp.headers['content-length']));
        }
        if (resp.headers['content-range']) {
          res.setHeader('Content-Range', String(resp.headers['content-range']));
        }
        if (isDownload) {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        }

        // Si el cliente cierra (cambio de cancion), cortamos la descarga upstream
        req.on('close', () => resp.data.destroy());
        resp.data.on('error', () => {
          if (!res.writableEnded) res.end();
        });
        resp.data.pipe(res);
        return true;
      } catch {
        // reintenta
      }
    }
    return false;
  }

  const successPrimary = await tryStream(targetUrl);
  if (successPrimary) return;

  if (fallbackUrl) {
    const successFallback = await tryStream(fallbackUrl);
    if (successFallback) return;
  }

  if (!res.headersSent) {
    res.status(502).json({ error: 'Audio stream currently unavailable' });
  }
}

export default async function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ---------------------------------------------------------------------------
  // 1. DIRECT STREAM / PROXY MODE (For iframe compatibility & zero CORS/format issues)
  // ---------------------------------------------------------------------------
  if (req.query?.stream === 'true' || req.query?.download === 'true') {
    const targetUrl = (req.query?.url as string) || '';
    const fallbackUrl = (req.query?.fallback as string) || '';
    if (!targetUrl) {
      return res.status(400).send('Missing url for streaming');
    }
    return streamAudioUrl(req, res, targetUrl, fallbackUrl);
  }

  const rawQuery = (req.query?.q as string) || (req.query?.url as string) || '';
  const trackId = (req.query?.trackId as string) || (req.query?.id as string) || '';
  let title = (req.query?.title as string) || '';
  let artist = (req.query?.artist as string) || '';
  let expectedDuration = Number(req.query?.duration) || 0;

  if (!rawQuery && !trackId && !title) {
    return res.status(400).json({ error: 'Missing query or track parameter' });
  }

  // If trackId is provided and missing title/artist/duration, fetch accurate metadata from Deezer track API
  if (trackId && (!title || !expectedDuration)) {
    try {
      const deezerTrackRes = await fetch(`https://api.deezer.com/track/${trackId}`, {
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      if (deezerTrackRes.ok) {
        const dData: any = await deezerTrackRes.json();
        if (dData?.id) {
          title = title || dData.title || '';
          artist = artist || dData.artist?.name || '';
          expectedDuration = expectedDuration || dData.duration || 0;
        }
      }
    } catch {
      // Continue with whatever info we have
    }
  }

  const cacheKey = `${trackId || ''}_${(title || rawQuery).trim().toLowerCase()}_${(artist || '').trim().toLowerCase()}_${expectedDuration}`;
  if (audioCache.has(cacheKey)) {
    const cachedResult = audioCache.get(cacheKey);
    if (req.query?.redirect === 'true') {
      return res.redirect(302, cachedResult.url);
    }
    return res.json({ status: true, source: cachedResult.source || 'cache', result: cachedResult });
  }

  // =========================================================================
  // STEP 1 (PRIMARY - USER SPECIFIED):
  // 1. Usar yt-search para encontrar el video de YouTube exacto con la duración del search de Deezer
  // 2. Extraer la URL de YouTube del video encontrado por yt-search
  // 3. Ejecutar scrapeYoutubeToMp3(videoUrl) con la URL de YouTube obtenida
  // =========================================================================
  try {
    const yts = await getYTSearch();
    const ytdl = await getYTDL();

    // Prepare search queries: artist + title exactly, then cleaned query
    const directSearchQuery = `${artist} ${title || rawQuery}`.trim();
    const cleanSearch = cleanAudioQuery(directSearchQuery);

    let candidateVideos: any[] = [];

    // Search with yt-search
    if (yts) {
      try {
        const searchRes = await yts(directSearchQuery);
        if (searchRes?.videos && Array.isArray(searchRes.videos) && searchRes.videos.length > 0) {
          candidateVideos = searchRes.videos;
        } else if (cleanSearch !== directSearchQuery) {
          const fallbackRes = await yts(cleanSearch);
          if (fallbackRes?.videos && Array.isArray(fallbackRes.videos)) {
            candidateVideos = fallbackRes.videos;
          }
        }
      } catch (ytsErr) {
        console.warn('[yt-search] Search warning:', ytsErr);
      }
    }

    // Fallback to ytdl's search if yt-search had no results
    if (candidateVideos.length === 0 && ytdl?.yts) {
      try {
        const ytdlSearch = await ytdl.yts(directSearchQuery);
        candidateVideos = Array.isArray(ytdlSearch?.videos)
          ? ytdlSearch.videos
          : Array.isArray(ytdlSearch?.result)
          ? ytdlSearch.result
          : [];
      } catch {}
    }

    if (candidateVideos.length > 0) {
      // Find candidate video whose duration is closest to expectedDuration
      let matchedVideo = candidateVideos[0];

      if (expectedDuration > 0) {
        let minDiff = Infinity;
        for (const v of candidateVideos.slice(0, 15)) {
          const sec = v.seconds || parseDurationSec(v.duration || v.timestamp);
          if (sec > 0) {
            const diff = Math.abs(sec - expectedDuration);
            if (diff < minDiff) {
              minDiff = diff;
              matchedVideo = v;
            }
          }
        }
      }

      // Exact YouTube URL from yt-search
      const videoUrl = matchedVideo.url || `https://www.youtube.com/watch?v=${matchedVideo.id || matchedVideo.videoId}`;
      console.log(`[Audio Pipeline] 🎯 Matched video with yt-search: "${matchedVideo.title}" (${matchedVideo.seconds || matchedVideo.duration}s, target: ${expectedDuration}s) -> ${videoUrl}`);

      // 1.1 Ejecutar resolvePreview con la URL de YouTube (módulo Innertube + scriptmind solicitado por el usuario)
      let scriptmindAudioUrl: string | null = null;
      try {
        const resolved = await resolvePreview(videoUrl);
        if (resolved?.success && resolved.result) {
          const data = resolved.result;
          const media = typeof data.resolvedMediaJson === 'string'
            ? JSON.parse(data.resolvedMediaJson)
            : data.resolvedMediaJson;
          scriptmindAudioUrl = media?.tunnel?.[1] || null;
          if (scriptmindAudioUrl) {
            console.log(`[Audio Pipeline] ✅ Scriptmind audio tunnel obtenido para: ${videoUrl}`);
          }
        }
      } catch (smErr: any) {
        console.warn('[Audio Pipeline] resolvePreview notice:', smErr?.message || smErr);
      }

      // 1.2 Ejecutar la función scrapeYoutubeToMp3 del usuario con la URL de YouTube de yt-search
      let y2jarResult: any = null;
      try {
        y2jarResult = await scrapeYoutubeToMp3(videoUrl);
      } catch (y2jarErr: any) {
        console.warn('[Audio Pipeline] scrapeYoutubeToMp3 exception:', y2jarErr?.message || y2jarErr);
      }

      // 1.3 También convertir el video emparejado con iguro-ytdl ytmp3
      let iguroUrl: string | null = null;
      if (ytdl?.ytmp3) {
        try {
          const iguroRes = await ytdl.ytmp3(videoUrl);
          if (iguroRes?.status && iguroRes?.result) {
            iguroUrl = iguroRes.result.download?.mp3 || iguroRes.result.url || null;
          }
        } catch (iguroErr) {
          console.warn('[Audio Pipeline] iguro ytmp3 notice:', iguroErr);
        }
      }

      // Determinar cuál es el audio principal y cuál el fallback
      let primaryAudioUrl: string | null = null;
      let fallbackAudioUrl: string | null = null;
      let sourceName = 'scriptmind-youtubei';

      if (scriptmindAudioUrl) {
        primaryAudioUrl = scriptmindAudioUrl;
        fallbackAudioUrl = iguroUrl || y2jarResult?.downloadUrl;
        sourceName = 'scriptmind-youtubei';
      } else if (y2jarResult?.downloadUrl) {
        // Verificar rápidamente si y2jar downloadUrl es audio binario
        try {
          const checkHead = await axios.head(y2jarResult.downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://v2.y2jar.cc/',
            },
            timeout: 2000,
          });
          const ct = String(checkHead.headers['content-type'] || '');
          if (!ct.includes('text/plain') && !ct.includes('text/html')) {
            primaryAudioUrl = y2jarResult.downloadUrl;
            fallbackAudioUrl = iguroUrl;
            sourceName = 'y2jar';
          } else {
            primaryAudioUrl = iguroUrl || y2jarResult.downloadUrl;
            fallbackAudioUrl = y2jarResult.downloadUrl;
            sourceName = 'yt-search-matched';
          }
        } catch {
          primaryAudioUrl = iguroUrl || y2jarResult.downloadUrl;
          fallbackAudioUrl = y2jarResult.downloadUrl;
          sourceName = 'yt-search-matched';
        }
      } else if (iguroUrl) {
        primaryAudioUrl = iguroUrl;
        sourceName = 'yt-search-matched';
      }

      if (primaryAudioUrl) {
        const resultTitle = y2jarResult?.title || matchedVideo.title || title || rawQuery;
        const resultArtist = y2jarResult?.author || artist;
        const resultThumbnail = y2jarResult?.thumbnail || matchedVideo.thumbnail;
        const cleanName = `${resultArtist} - ${resultTitle}`.replace(/[/\\?%*:|"<>]/g, '');

        const proxiedStreamUrl = `/api/yt-audio?stream=true&url=${encodeURIComponent(primaryAudioUrl)}${fallbackAudioUrl ? `&fallback=${encodeURIComponent(fallbackAudioUrl)}` : ''}`;
        const proxiedDownloadUrl = `/api/yt-audio?download=true&name=${encodeURIComponent(cleanName + '.mp3')}&url=${encodeURIComponent(primaryAudioUrl)}${fallbackAudioUrl ? `&fallback=${encodeURIComponent(fallbackAudioUrl)}` : ''}`;

        const result = {
          title: resultTitle,
          artist: resultArtist,
          thumbnail: resultThumbnail,
          duration: matchedVideo.seconds || expectedDuration,
          url: proxiedStreamUrl,
          directUrl: primaryAudioUrl,
          downloadUrl: proxiedDownloadUrl,
          source: sourceName,
        };

        audioCache.set(cacheKey, result);
        console.log(`[Audio Pipeline] ✅ Audio listo para reproducir/descargar (${sourceName}): "${result.title}"`);

        if (req.query?.redirect === 'true') {
          return res.redirect(302, result.url);
        }
        return res.json({ status: true, source: sourceName, result });
      }
    }
  } catch (opt1Err: any) {
    console.warn('[Audio Pipeline] Opción 1 falló:', opt1Err?.message || opt1Err);
  }

  // =========================================================================
  // STEP 2 (DIRECT YOUTUBEI): YouTubeplay directo con Innertube (youtubei.js)
  // =========================================================================
  try {
    const directSearchQuery = `${artist} ${title || rawQuery}`.trim();
    const ytPlayRes = await YouTubeplay(directSearchQuery);
    if (ytPlayRes?.success && ytPlayRes?.result?.audio) {
      const r = ytPlayRes.result;
      const resTitle = r.title || title || rawQuery;
      const cleanName = `${artist} - ${resTitle}`.replace(/[/\\?%*:|"<>]/g, '');

      const proxiedStreamUrl = `/api/yt-audio?stream=true&url=${encodeURIComponent(r.audio)}`;
      const proxiedDownloadUrl = `/api/yt-audio?download=true&name=${encodeURIComponent(cleanName + '.mp3')}&url=${encodeURIComponent(r.audio)}`;

      const result = {
        title: resTitle,
        artist: artist,
        thumbnail: r.thumbnail,
        duration: expectedDuration,
        url: proxiedStreamUrl,
        directUrl: r.audio,
        downloadUrl: proxiedDownloadUrl,
        source: 'youtubei-play',
      };

      audioCache.set(cacheKey, result);
      console.log(`[Audio Pipeline] ✅ Opción YouTubeplay (Innertube) exitosa: ${result.title}`);

      if (req.query?.redirect === 'true') {
        return res.redirect(302, result.url);
      }
      return res.json({ status: true, source: 'youtubei-play', result });
    }
  } catch (ytPlayErr: any) {
    console.warn(`[Audio Pipeline] YouTubeplay notice: ${ytPlayErr?.message || ytPlayErr}`);
  }

  // =========================================================================
  // STEP 3 (FALLBACK): ytplay directo (iguro-ytdl)
  // =========================================================================
  try {
    const ytdl = await getYTDL();
    if (ytdl?.ytplay) {
      const searchQuery = `${artist} ${title || rawQuery}`.trim();
      const ytplayRes = await ytdl.ytplay(searchQuery);
      if (ytplayRes?.status && ytplayRes?.result) {
        const mp3Url = ytplayRes.result.download?.mp3 || ytplayRes.result.url;
        if (mp3Url) {
          const resTitle = ytplayRes.result.title || title || rawQuery;
          const resArtist = ytplayRes.result.channel || artist;
          const cleanName = `${resArtist} - ${resTitle}`.replace(/[/\\?%*:|"<>]/g, '');

          const proxiedStreamUrl = `/api/yt-audio?stream=true&url=${encodeURIComponent(mp3Url)}`;
          const proxiedDownloadUrl = `/api/yt-audio?download=true&name=${encodeURIComponent(cleanName + '.mp3')}&url=${encodeURIComponent(mp3Url)}`;

          const result = {
            title: resTitle,
            channel: ytplayRes.result.channel,
            thumbnail: ytplayRes.result.thumbnail,
            duration: ytplayRes.result.duration,
            url: proxiedStreamUrl,
            directUrl: mp3Url,
            downloadUrl: proxiedDownloadUrl,
            source: 'ytplay-fallback',
          };

          audioCache.set(cacheKey, result);
          if (req.query?.redirect === 'true') {
            return res.redirect(302, result.url);
          }
          return res.json({ status: true, source: 'ytplay-fallback', result });
        }
      }
    }
  } catch (fallbackErr) {
    console.warn('Final fallback notice:', fallbackErr);
  }

  return res.status(404).json({ status: false, error: 'Audio not found' });
}
