import React, { useEffect } from 'react';
import { motion, useAnimation } from 'motion/react';

interface AnimatedWordProps {
  text: string;
  // true mientras el reproductor esta sobre esta palabra (o ya la paso, dentro de la linea activa)
  isActive: boolean;
  // ms que dura el "encendido" de la palabra (se pasa a la curva de easing, igual que el codigo original)
  durationMs: number;
}

// Replica AnimatedWord.tsx (React Native): cada palabra sube de opacidad 0.1 -> 1
// cuando le toca sonar, con una curva suave (easeInOut) y la MISMA duracion que
// dura esa palabra en la letra. No hay desplazamiento ni escala, solo opacidad.
const AnimatedWord: React.FC<AnimatedWordProps> = ({ text, isActive, durationMs }) => {
  const controls = useAnimation();

  useEffect(() => {
    controls.start({
      opacity: isActive ? 1 : 0.1,
      transition: { duration: Math.max(durationMs, 80) / 1000, ease: [0.45, 0, 0.55, 1] },
    });
  }, [isActive, durationMs, controls]);

  return (
    <motion.span
      initial={{ opacity: 0.1 }}
      animate={controls}
      className="inline-block will-change-[opacity]"
    >
      {text}
    </motion.span>
  );
};

export default AnimatedWord;
