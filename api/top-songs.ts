import type { Request, Response } from 'express';

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

  try {
    const response = await fetch('https://api.deezer.com/chart/0/tracks?limit=60', {
      headers: {
        accept: '*/*',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const data: any = await response.json();

    if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
      const fetchedTracks = data.data
        .filter((track: any) => track && track.id && (track.title || track.title_short))
        .map((track: any) => ({
          id: String(track.id),
          title: track.title || track.title_short || 'Untitled',
          artist: track.artist?.name || 'Unknown Artist',
          coverUrl:
            track.album?.cover_xl ||
            track.album?.cover_big ||
            track.album?.cover_medium ||
            track.album?.cover ||
            track.artist?.picture_xl ||
            track.artist?.picture_big ||
            'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
          audioUrl: `/api/stream?id=${track.id}`,
          duration: track.duration || 210,
          durationFormatted: formatDuration(track.duration),
        }));

      return res.status(200).json(fetchedTracks);
    }

    // Fallback: popular search tracks with verified album arts
    const fallbackRes = await fetch('https://api.deezer.com/search/track?q=top+hits&limit=40', {
      headers: {
        accept: '*/*',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const fallbackData: any = await fallbackRes.json();

    const fallbackTracks = (fallbackData?.data || [])
      .filter((track: any) => track && track.id && (track.title || track.title_short))
      .map((track: any) => ({
        id: String(track.id),
        title: track.title || track.title_short || 'Untitled',
        artist: track.artist?.name || 'Unknown Artist',
        coverUrl:
          track.album?.cover_xl ||
          track.album?.cover_big ||
          track.album?.cover_medium ||
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
        audioUrl: `/api/stream?id=${track.id}`,
        duration: track.duration || 210,
        durationFormatted: formatDuration(track.duration),
      }));

    return res.status(200).json(fallbackTracks);
  } catch (err) {
    console.error("Top songs fetch error:", err);
    return res.status(200).json([]);
  }
}
