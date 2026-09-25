import React from 'react';
import { motion } from 'motion/react';
import AnimatedWord from './AnimatedWord';
import MusicLine from './MusicLine';

interface WordTiming {
  text: string;
  start: number; // segundos
  end: number; // segundos
}

interface LyricsLineProps {
  words: WordTiming[];
  text: string;
  isActiveLine: boolean;
  currentTime: number;
  nextLineStart?: number;
  isMusicLine?: boolean;
  onSeek: (time: number) => void;
  lineTime: number;
}

// Replica LyricsLine.tsx (React Native): la linea completa sube de opacidad
// 0.1 -> 1 cuando esta activa (igual que el viewOpacity/withTiming del codigo
// original), y ademas cada palabra dentro de ella se enciende segun le toque
// sonar (igual que AnimatedWord). La diferencia con el original: en vez de un
// setTimeout que avanza sola, aqui el tiempo real del audio decide que
// palabra esta activa, para que quede sincronizado sample a sample.
const LyricsLine: React.FC<LyricsLineProps> = ({
  words,
  text,
  isActiveLine,
  currentTime,
  nextLineStart,
  isMusicLine,
  onSeek,
  lineTime,
}) => {
  if (isMusicLine) {
    const duration = (nextLineStart ?? lineTime + 2) - lineTime;
    return <MusicLine isActiveLine={isActiveLine} duration={duration * 1000} />;
  }

  return (
    <motion.div
      onClick={(e) => {
        e.stopPropagation();
        onSeek(lineTime);
      }}
      animate={{ opacity: isActiveLine ? 1 : 0.1 }}
      transition={{ duration: 0.1, ease: [0.45, 0, 0.55, 1] }}
      className="mb-[35px] flex flex-wrap font-black text-[32px] sm:text-[38px] leading-tight text-white cursor-pointer"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif" }}
    >
      {words.length > 0
        ? words.map((word, idx) => {
            const wordDurationMs =
              idx < words.length - 1
                ? (words[idx + 1].start - word.start) * 1000
                : nextLineStart
                ? (nextLineStart - word.start) * 1000
                : 500;
            // Activa cuando el reproductor esta dentro (o ya paso) esta palabra,
            // pero solo mientras la linea en si esta activa
            const wordActive = isActiveLine && currentTime >= word.start;
            return (
              <React.Fragment key={`${word.text}-${idx}`}>
                <AnimatedWord text={word.text} isActive={wordActive} durationMs={wordDurationMs} />
                {idx < words.length - 1 ? '\u00A0' : ''}
              </React.Fragment>
            );
          })
        : text}
    </motion.div>
  );
};

export default LyricsLine;
