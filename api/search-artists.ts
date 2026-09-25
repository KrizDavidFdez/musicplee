import type { Request, Response } from 'express';

const artistSearchCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

export default async function handler(req: Request | any, res: Response | any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query?.q as string || "").toLowerCase().trim();
  if (!query) {
    return res.json([]);
  }

  // Instant in-memory cache hit
  const cached = artistSearchCache.get(query);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=10`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const fetchRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': '*/*',
        'user-agent': 'Mozilla/5.0'
      }
    });
    clearTimeout(timeout);

    const data: any = await fetchRes.json();

    const results = (data?.data || []).map((artist: any) => ({
      id: String(artist.id),
      name: artist.name || '',
      pictureUrl:
        artist.picture_xl ||
        artist.picture_big ||
        artist.picture_medium ||
        null
    }));

    artistSearchCache.set(query, { data: results, timestamp: Date.now() });

    res.json(results);
  } catch (err) {
    console.error("Search artists error:", err);
    res.json([]);
  }
}
