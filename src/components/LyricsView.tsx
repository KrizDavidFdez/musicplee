import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LyricLine } from '../types';
import { computeLineWords } from '../lib/lyrics';
import LyricsLine from './LyricsLine';

interface LyricsViewProps {
  lyrics: LyricLine[];
  isSynced: boolean;
  activeLyricIndex: number;
  isIntroInstrumental?: boolean;
  onSeek: (time: number) => void;
  isLoading?: boolean;
  isControlsHidden?: boolean;
  onToggleControls?: () => void;
  currentTime?: number;
  isKaraokeEffect?: boolean;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
}

// (ver uso de isKaraokeEffect mas abajo: activa/desactiva el encendido palabra por palabra)

function cleanLyricText(text: string): string {
  let cleaned = text || '';
  if (cleaned.includes('^')) {
    cleaned = cleaned.split('^')[0];
  }
  return cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

interface PreparedLine {
  index: number;
  time: number;
  nextTime?: number;
  text: string;
  isMusicLine: boolean;
  words: { text: string; start: number; end: number }[];
}

export const LyricsView: React.FC<LyricsViewProps> = React.memo(({
  lyrics,
  isSynced,
  activeLyricIndex,
  isIntroInstrumental = false,
  onSeek,
  isLoading,
  isControlsHidden = false,
  onToggleControls,
  currentTime = 0,
  isKaraokeEffect = true,
  audioRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  // Prepara cada linea con su texto limpio y el timing por palabra (propio del
  // backend si vino, o sintetizado con computeLineWords si no).
  const preparedLines: PreparedLine[] = useMemo(() => {
    return lyrics.map((item, i) => {
      const rawText = cleanLyricText(item.text);
      const isMusicLine = rawText === '\u266A' || rawText === '\u266B' || item.text === '\u266A' || item.text === '\u266B';
      const nextTime = lyrics[i + 1]?.time;

      let words: { text: string; start: number; end: number }[] = [];
      if (!isMusicLine) {
        if (item.words && item.words.length > 0) {
          words = item.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
        } else if (rawText) {
          words = computeLineWords(rawText, item.time, nextTime);
        }
      }

      return { index: i, time: item.time, nextTime, text: rawText, isMusicLine, words };
    });
  }, [lyrics]);

  // Autoscroll suave hacia la linea activa, centrada en el contenedor
  useEffect(() => {
    const container = containerRef.current;
    const activeEl = activeLineRef.current;
    if (!container || !activeEl) return;
    const targetTop = activeEl.offsetTop - container.clientHeight * 0.38;
    container.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' });
  }, [activeLyricIndex]);

  const handleContainerClick = () => {
    onToggleControls?.();
  };

  // Cuando hay audioRef, leemos el tiempo real del <audio> a ~15fps (suficiente
  // para que las palabras se enciendan a tiempo, sin forzar 60fps de renders).
  const [tickTime, setTickTime] = useState(currentTime);
  useEffect(() => {
    if (!audioRef) return;
    let rafId: number;
    let lastUpdate = 0;
    const loop = (now: number) => {
      if (now - lastUpdate >= 66) {
        lastUpdate = now;
        const el = audioRef.current;
        if (el) {
          setTickTime(el.currentTime);
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [audioRef]);

  const liveTime = audioRef ? tickTime : currentTime;

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className="relative flex-1 w-full h-full overflow-y-auto overflow-x-hidden select-none cursor-pointer no-scrollbar"
      style={{
        maskImage: isControlsHidden
          ? 'linear-gradient(to bottom, transparent 0%, black 6%, black 90%, transparent 100%)'
          : 'linear-gradient(to bottom, transparent 0%, black 6%, black 54%, transparent 72%)',
        WebkitMaskImage: isControlsHidden
          ? 'linear-gradient(to bottom, transparent 0%, black 6%, black 90%, transparent 100%)'
          : 'linear-gradient(to bottom, transparent 0%, black 6%, black 54%, transparent 72%)',
        transition: 'mask-image 0.25s ease, -webkit-mask-image 0.25s ease',
      }}
    >
      <div className="px-6 sm:px-10" style={{ paddingTop: 100, paddingBottom: 220 }}>
        {isSynced
          ? preparedLines.map((line) => {
              const isActive = line.index === activeLyricIndex;
              return (
                <div key={line.index} ref={isActive ? activeLineRef : undefined}>
                  <LyricsLine
                    words={isKaraokeEffect ? line.words : []}
                    text={line.text}
                    isActiveLine={isActive}
                    currentTime={liveTime}
                    nextLineStart={line.nextTime}
                    isMusicLine={line.isMusicLine}
                    onSeek={onSeek}
                    lineTime={line.time}
                  />
                </div>
              );
            })
          : preparedLines.map((line) => (
              <div
                key={line.index}
                className="mb-[35px] font-black text-[32px] sm:text-[38px] leading-tight text-white/90"
                style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif" }}
              >
                {line.text}
              </div>
            ))}
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-white/75 animate-bounce [animation-delay:-0.3s]" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/75 animate-bounce [animation-delay:-0.15s]" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/75 animate-bounce" />
          </div>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  if (
    prev.lyrics !== next.lyrics ||
    prev.isSynced !== next.isSynced ||
    prev.isLoading !== next.isLoading ||
    prev.isControlsHidden !== next.isControlsHidden ||
    prev.isIntroInstrumental !== next.isIntroInstrumental ||
    prev.isKaraokeEffect !== next.isKaraokeEffect ||
    prev.activeLyricIndex !== next.activeLyricIndex ||
    prev.audioRef !== next.audioRef ||
    prev.onSeek !== next.onSeek ||
    prev.onToggleControls !== next.onToggleControls
  ) {
    return false;
  }
  // Si hay audioRef, cada AnimatedWord lee currentTime en vivo del <audio>,
  // asi que no hace falta re-renderizar todo el arbol en cada tick de tiempo.
  if (prev.audioRef?.current) {
    return true;
  }
  return prev.currentTime === next.currentTime;
});

LyricsView.displayName = 'LyricsView';
