import type { Request, Response } from 'express';

const searchCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const formatDuration = (sec: number) => {
  if (!sec || isNaN(sec)) return '03:30';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default async function handler(req: Request | any, res: Response | any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query?.q as string || "").toLowerCase().trim();

  if (!query) {
    return res.json([]);
  }

  // Instant in-memory cache hit
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=35`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: '*/*',
        'user-agent': 'Mozilla/5.0'
      }
    });
    clearTimeout(timeout);

    const data: any = await response.json();

    const results = (data?.data || []).map((track: any) => ({
      id: String(track.id),
      title: track.title || '',
      artist: track.artist?.name || '',
      coverUrl:
        track.album?.cover_xl ||
        track.album?.cover_big ||
        track.album?.cover_medium ||
        track.album?.cover ||
        track.artist?.picture_xl ||
        track.artist?.picture_big ||
        null,
      audioUrl: `/api/stream?id=${track.id}`,
      duration: track.duration || 210,
      durationFormatted: formatDuration(track.duration),
    }));

    searchCache.set(query, { data: results, timestamp: Date.now() });

    return res.json(results);
  } catch (err) {
    console.error("Search handler error:", err);
    return res.json([]);
  }
}
