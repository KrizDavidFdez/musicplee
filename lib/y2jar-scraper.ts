import axios from 'axios';

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": "https://v2.y2jar.cc/"
};

// Ekstrak YouTube ID dari URL
export function extractVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  return match ? match[1] : null;
}

export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface Y2JarResult {
  title?: string;
  author?: string;
  thumbnail?: string;
  downloadUrl?: string;
  error?: string;
}

export async function scrapeYoutubeToMp3(youtubeUrl: string): Promise<Y2JarResult> {
  try {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      return { error: "URL YouTube tidak valid." };
    }
    
    // 1. Dapatkan info video (Title, Thumbnail, dll)
    let info: any = {};
    try {
      const infoRes = await axios.get(`https://v2.y2jar.cc/i/${videoId}`, { headers, timeout: 6000 });
      info = infoRes.data || {};
    } catch (e) {
      // Abaikan error info, tetep lanjutin proses konversi
    }
    
    // 2. Gunakan endpoint alt conversion (s=5) untuk nge-bypass Turnstile dan dapetin direct MP3
    let downloadUrl: string | null = null;
    for (let i = 0; i < 12; i++) { // Max coba 12 kali (60 detik)
      try {
        const res = await axios.get(`https://capi.y2jar.cc/scr/${videoId}?s=5`, { headers, timeout: 6000 });
        if (res.data?.downloadUrl) {
          downloadUrl = res.data.downloadUrl;
          break;
        }
        
        if (res.data?.status) {
          // Masih processing/converting, tunggu 5 detik
          await delay(5000);
        } else {
          break;
        }
      } catch (e: any) {
        if (e.response && e.response.status === 404) {
          return { error: "Video tidak ditemukan atau tidak bisa dikonversi." };
        }
        // Kalau error lain (misal 5xx temporary), tunggu lalu coba lagi
        await delay(3000);
      }
    }
    
    if (!downloadUrl) {
      return { error: "Gagal mendapatkan URL download, timeout atau error dari server." };
    }

        return {
            title: info.title || "Unknown Title",
            author: info.author || "Unknown",
            thumbnail: info.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            downloadUrl: downloadUrl
        };
        
    } catch (e: any) {
        return { error: e.message || 'Scrape error' };
    }
}
