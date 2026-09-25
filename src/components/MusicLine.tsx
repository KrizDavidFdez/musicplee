import React from 'react';
import { motion } from 'motion/react';

interface MusicLineProps {
  isActiveLine: boolean;
  duration: number; // ms que dura el hueco instrumental
}

// Equivalente del componente MusicLine que usa LyricsLine.tsx (RN) para las
// pausas instrumentales ("♪"): tres puntos que laten mientras esa parte suena.
const MusicLine: React.FC<MusicLineProps> = ({ isActiveLine, duration }) => {
  return (
    <div className="flex items-center gap-2 mb-[35px] h-8">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2.5 h-2.5 rounded-full bg-white"
          animate={{
            opacity: isActiveLine ? [0.25, 1, 0.25] : 0.1,
            scale: isActiveLine ? [0.85, 1, 0.85] : 0.85,
          }}
          transition={{
            duration: Math.max(duration, 600) / 1000,
            repeat: isActiveLine ? Infinity : 0,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
};

export default MusicLine;
