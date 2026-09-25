import axios from 'axios';
import crypto from 'crypto';
import { Innertube } from 'youtubei.js';

let youtube: any = null;

export async function getYoutube(): Promise<any> {
  if (!youtube) {
    youtube = await Innertube.create();
  }
  return youtube;
}

export async function resolvePreview(url: string): Promise<any> {
  try {
    const guestId = crypto.randomUUID();

    const response = await axios.post(
      'https://scriptmind.co/api/media/resolve/preview',
      {
        url,
        platform: 'youtube',
        pageType: 'video',
        guestId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return response.data;
  } catch (error: any) {
    return {
      success: false,
      message:
        error.response?.data?.message ||
        error.response?.data ||
        error.message ||
        'Gagal resolve video',
    };
  }
}

export function getThumbnail(video: any): string | null {
  const thumbnails = video.thumbnails || [];
  if (!thumbnails.length) return null;
  return thumbnails[thumbnails.length - 1]?.url || null;
}

export async function YouTubeplay(query: string): Promise<any> {
  try {
    if (!query || typeof query !== 'string') {
      return {
        success: false,
        message: 'Query harus berupa teks',
      };
    }

    const yt = await getYoutube();

    const search = await yt.search(query, {
      type: 'video',
    });

    const video = search.videos?.[0];

    if (!video) {
      return {
        success: false,
        message: 'Video tidak ditemukan',
      };
    }

    const videoId = video.id;

    if (!videoId) {
      return {
        success: false,
        message: 'Video ID tidak ditemukan',
      };
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    const resolved = await resolvePreview(url);

    if (!resolved?.success) {
      return {
        success: false,
        message: resolved?.message || 'Gagal resolve video',
      };
    }

    const data = resolved.result || {};

    let media: any;

    try {
      media =
        typeof data.resolvedMediaJson === 'string'
          ? JSON.parse(data.resolvedMediaJson)
          : data.resolvedMediaJson;
    } catch {
      return {
        success: false,
        message: 'Gagal membaca data media',
      };
    }

    const audio = media?.tunnel?.[1] || null;

    if (!audio) {
      return {
        success: false,
        message: 'URL audio tidak ditemukan',
      };
    }

    return {
      success: true,
      result: {
        title: video.title?.text || data.title || null,
        videoId,
        url,
        thumbnail: getThumbnail(video),
        duration:
          video.duration?.text ||
          video.duration?.seconds ||
          data.duration ||
          null,
        audio,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Terjadi kesalahan',
    };
  }
}
