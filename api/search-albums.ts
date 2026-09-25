import type { Request, Response } from 'express';

const albumCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default async function handler(req: Request | any, res: Response | any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = ((req.query?.q as string) || '').toLowerCase().trim();

  if (!query) {
    return res.json([]);
  }

  const cached = albumCache.get(query);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=25`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: '*/*',
        'user-agent': 'Mozilla/5.0',
      },
    });
    clearTimeout(timeout);

    const data: any = await response.json();
    const albums = (data?.data || []).map((album: any) => ({
      id: String(album.id),
      title: album.title || '',
      artist: album.artist?.name || '',
      coverUrl:
        album.cover_xl ||
        album.cover_big ||
        album.cover_medium ||
        album.cover ||
        '',
      trackCount: album.nb_tracks || 0,
    }));

    albumCache.set(query, { data: albums, timestamp: Date.now() });
    return res.json(albums);
  } catch (error) {
    console.error('Error searching albums:', error);
    return res.json([]);
  }
}
