import React, { useEffect, useState, useMemo } from 'react';
import { Track } from '../types';

interface LiquidBackgroundProps {
  currentTrack: Track | null;
  className?: string;
}

interface PaletteTheme {
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  base: string;
}

// Preset dynamic Apple Music color atmospheres
const PRESET_PALETTES: Record<string, PaletteTheme> = {
  understand: {
    c1: 'rgba(235, 30, 75, 0.85)',
    c2: 'rgba(180, 20, 60, 0.8)',
    c3: 'rgba(110, 15, 45, 0.9)',
    c4: 'rgba(255, 100, 130, 0.65)',
    base: '#1a040b',
  },
  keshi: {
    c1: 'rgba(225, 29, 72, 0.85)',
    c2: 'rgba(159, 18, 57, 0.8)',
    c3: 'rgba(88, 28, 135, 0.9)',
    c4: 'rgba(251, 113, 133, 0.6)',
    base: '#18030b',
  },
  golden: {
    c1: 'rgba(245, 158, 11, 0.85)',
    c2: 'rgba(217, 119, 6, 0.8)',
    c3: 'rgba(146, 64, 14, 0.9)',
    c4: 'rgba(253, 224, 71, 0.6)',
    base: '#190e02',
  },
  hindia: {
    c1: 'rgba(239, 68, 68, 0.85)',
    c2: 'rgba(185, 28, 28, 0.8)',
    c3: 'rgba(69, 10, 10, 0.9)',
    c4: 'rgba(248, 113, 113, 0.6)',
    base: '#140303',
  },
  coastline: {
    c1: 'rgba(56, 189, 248, 0.8)',
    c2: 'rgba(14, 165, 233, 0.75)',
    c3: 'rgba(3, 105, 161, 0.85)',
    c4: 'rgba(186, 230, 253, 0.6)',
    base: '#031726',
  },
  weeknd: {
    c1: 'rgba(220, 38, 38, 0.85)',
    c2: 'rgba(153, 27, 27, 0.8)',
    c3: 'rgba(69, 10, 10, 0.92)',
    c4: 'rgba(252, 165, 165, 0.55)',
    base: '#160404',
  },
};

// High-speed in-memory palette cache to eliminate canvas/image re-computations
const THEME_CACHE = new Map<string, PaletteTheme>();

export const LiquidBackground: React.FC<LiquidBackgroundProps> = React.memo(({ currentTrack, className }) => {
  const [extractedTheme, setExtractedTheme] = useState<PaletteTheme | null>(null);

  // Dynamic color extraction from album cover image with memory caching
  useEffect(() => {
    if (!currentTrack?.coverUrl) return;

    if (THEME_CACHE.has(currentTrack.coverUrl)) {
      setExtractedTheme(THEME_CACHE.get(currentTrack.coverUrl)!);
      return;
    }

    const key = Object.keys(PRESET_PALETTES).find(
      (k) =>
        currentTrack.title.toLowerCase().includes(k) ||
        currentTrack.artist.toLowerCase().includes(k)
    );

    if (key) {
      const preset = PRESET_PALETTES[key];
      THEME_CACHE.set(currentTrack.coverUrl, preset);
      setExtractedTheme(preset);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = currentTrack.coverUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, 4, 4);
        const data = ctx.getImageData(0, 0, 4, 4).data;

        const r1 = data[0], g1 = data[1], b1 = data[2];
        const r2 = data[8 * 4] || r1, g2 = data[8 * 4 + 1] || g1, b2 = data[8 * 4 + 2] || b1;
        const r3 = data[15 * 4] || r1, g3 = data[15 * 4 + 1] || g1, b3 = data[15 * 4 + 2] || b1;

        const themeResult: PaletteTheme = {
          c1: `rgba(${r1}, ${g1}, ${b1}, 0.85)`,
          c2: `rgba(${r2}, ${g2}, ${b2}, 0.8)`,
          c3: `rgba(${Math.floor(r3 * 0.4)}, ${Math.floor(g3 * 0.4)}, ${Math.floor(b3 * 0.4)}, 0.9)`,
          c4: `rgba(${Math.min(255, r1 + 60)}, ${Math.min(255, g1 + 60)}, ${Math.min(255, b1 + 60)}, 0.65)`,
          base: `rgb(${Math.floor(r3 * 0.12)}, ${Math.floor(g3 * 0.12)}, ${Math.floor(b3 * 0.12)})`,
        };

        THEME_CACHE.set(currentTrack.coverUrl, themeResult);
        setExtractedTheme(themeResult);
      } catch {
        setExtractedTheme(null);
      }
    };
  }, [currentTrack?.coverUrl, currentTrack?.title, currentTrack?.artist]);

  const theme = useMemo(() => {
    if (extractedTheme) return extractedTheme;

    if (!currentTrack) {
      return {
        c1: 'rgba(225, 29, 72, 0.85)',
        c2: 'rgba(159, 18, 57, 0.8)',
        c3: 'rgba(88, 28, 135, 0.9)',
        c4: 'rgba(251, 113, 133, 0.6)',
        base: '#17030a',
      };
    }

    const hash = (currentTrack.title + currentTrack.artist)
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hash % 360;
    const hue2 = (hue + 40) % 360;
    const hue3 = (hue + 110) % 360;
    const hue4 = (hue + 170) % 360;

    return {
      c1: `hsla(${hue}, 85%, 46%, 0.85)`,
      c2: `hsla(${hue2}, 85%, 36%, 0.8)`,
      c3: `hsla(${hue3}, 90%, 18%, 0.9)`,
      c4: `hsla(${hue4}, 80%, 65%, 0.6)`,
      base: `hsl(${hue}, 45%, 5%)`,
    };
  }, [extractedTheme, currentTrack?.title, currentTrack?.artist]);

  return (
    <div
      id="liquid-background"
      className={className || "fixed inset-0 z-0 overflow-hidden pointer-events-none select-none transition-colors duration-700 w-full h-full"}
      style={{
        backgroundColor: theme.base,
        willChange: 'transform',
        transform: 'translateZ(0)',
        contain: 'strict',
      }}
    >
      {/* 1. Dynamic Flowing Album Cover Backdrop - High-efficiency smooth blur */}
      {currentTrack?.coverUrl && (
        <div
          style={{
            backgroundImage: `url(${currentTrack.coverUrl})`,
            willChange: 'transform',
            transform: 'translate3d(0, 0, 0)',
          }}
          className="absolute inset-[-12%] w-[124%] h-[124%] bg-cover bg-center opacity-55 saturate-125 blur-lg animate-liquid-cover"
        />
      )}

      {/* 2. Fluid Mesh Orb 1 (Top Left / Accent) */}
      <div
        style={{
          background: `radial-gradient(circle at 30% 30%, ${theme.c1} 0%, transparent 68%)`,
          willChange: 'transform',
          transform: 'translate3d(0, 0, 0)',
        }}
        className="absolute -top-[15%] -left-[10%] w-[100vw] h-[100vw] max-w-[800px] max-h-[800px] rounded-full blur-lg opacity-80 animate-liquid-orb-1"
      />

      {/* 3. Fluid Mesh Orb 2 (Right Center / Depth) */}
      <div
        style={{
          background: `radial-gradient(circle at 70% 60%, ${theme.c2} 0%, ${theme.c3} 50%, transparent 75%)`,
          willChange: 'transform',
          transform: 'translate3d(0, 0, 0)',
        }}
        className="absolute top-[20%] -right-[15%] w-[95vw] h-[95vw] max-w-[750px] max-h-[750px] rounded-full blur-lg opacity-75 animate-liquid-orb-2"
      />

      {/* 4. Fluid Mesh Orb 3 (Bottom Ambient Flare) */}
      <div
        style={{
          background: `radial-gradient(circle at 50% 50%, ${theme.c4} 0%, transparent 62%)`,
          willChange: 'transform',
          transform: 'translate3d(0, 0, 0)',
        }}
        className="absolute -bottom-[15%] left-[10%] w-[85vw] h-[85vw] max-w-[700px] max-h-[700px] rounded-full blur-lg opacity-65 animate-liquid-orb-3"
      />

      {/* 5. Apple Music Darkening Tint for crisp text contrast */}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
});

LiquidBackground.displayName = 'LiquidBackground';
