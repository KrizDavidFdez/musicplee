import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export interface GlassTab<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface LiquidGlassTabBarProps<T extends string> {
  tabs: GlassTab<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  isDark: boolean;
}

// La refraccion real (backdrop-filter: url(#svg)) solo existe en Chromium.
// En Safari/Firefox usamos vidrio esmerilado (blur + saturacion), que se ve casi igual.
function supportsSvgBackdrop(): boolean {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return false;
  const ua = navigator.userAgent;
  // Chrome, Edge, Brave, Opera, Samsung Internet (todos Chromium). Excluye Firefox y Safari puro.
  const isChromium = ['Chrome/', 'Chromium/', 'Edg/', 'OPR/'].some((token) => ua.indexOf(token) !== -1);
  const isIOS = /iPhone|iPad|iPod/.test(ua); // en iOS todos los navegadores usan WebKit
  return isChromium && !isIOS;
}

// Mapa de desplazamiento: centro neutro (gris 128) y bordes que empujan la luz hacia adentro
function buildDisplacementMap(w: number, h: number, radius: number, bezel: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const r = Math.min(radius, h / 2, w / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distancia al borde de la capsula redondeada
      const cx = Math.min(Math.max(x, r), w - r);
      const cy = Math.min(Math.max(y, r), h - r);
      const dx = x - cx;
      const dy = y - cy;
      const distFromCorner = Math.sqrt(dx * dx + dy * dy);
      const distToEdge = r - distFromCorner; // >0 dentro de la capsula

      let nx = 0;
      let ny = 0;
      if (distToEdge >= 0 && distToEdge < bezel && distFromCorner > 0) {
        // curva tipo lente: mas fuerte en el borde, nula hacia el centro
        const t = 1 - distToEdge / bezel;
        const strength = t * t * (3 - 2 * t);
        nx = -(dx / distFromCorner) * strength;
        ny = -(dy / distFromCorner) * strength;
      }
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(128 + nx * 127);
      img.data[i + 1] = Math.round(128 + ny * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function LiquidGlassTabBar<T extends string>({ tabs, activeTab, onChange, isDark }: LiquidGlassTabBarProps<T>) {
  const rawId = useId().replace(/:/g, '');
  const filterId = `lg-${rawId}`;
  const barRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [mapUrl, setMapUrl] = useState('');
  const [refract] = useState(supportsSvgBackdrop);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0 && h > 0) setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!refract || !size) return;
    setMapUrl(buildDisplacementMap(size.w, size.h, size.h / 2, Math.min(size.h * 0.55, 30)));
  }, [refract, size]);

  const useRefraction = refract && !!mapUrl && !!size;

  const tint = isDark ? 'rgba(28, 28, 32, 0.28)' : 'rgba(255, 255, 255, 0.34)';
  const tintBottom = isDark ? 'rgba(10, 10, 14, 0.42)' : 'rgba(255, 255, 255, 0.5)';
  const ink = isDark ? '#ffffff' : '#111111';
  const inkDim = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.5)';

  const backdrop = useRefraction
    ? `url(#${filterId}) blur(6px) saturate(190%) brightness(${isDark ? 1.08 : 1.04})`
    : `blur(22px) saturate(190%) brightness(${isDark ? 1.08 : 1.04})`;

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === activeTab));

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 bottom-0 z-30 flex justify-center px-6"
      style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
    >
      {useRefraction && size && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <filter
              id={filterId}
              x="0"
              y="0"
              width={size.w}
              height={size.h}
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feImage href={mapUrl} x="0" y="0" width={size.w} height={size.h} result="map" preserveAspectRatio="none" />
              {/* Tres pasadas (R, G, B) con distinta fuerza = aberracion cromatica en el borde */}
              <feDisplacementMap in="SourceGraphic" in2="map" scale="46" xChannelSelector="R" yChannelSelector="G" result="dispR" />
              <feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="R" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale="40" xChannelSelector="R" yChannelSelector="G" result="dispG" />
              <feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="G" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale="34" xChannelSelector="R" yChannelSelector="G" result="dispB" />
              <feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="B" />
              <feBlend in="R" in2="G" mode="screen" result="RG" />
              <feBlend in="RG" in2="B" mode="screen" />
            </filter>
          </defs>
        </svg>
      )}

      <div
        ref={barRef}
        role="tablist"
        className="pointer-events-auto relative flex items-center rounded-full p-1.5 w-full max-w-[360px]"
        style={{
          background: `linear-gradient(180deg, ${tint}, ${tintBottom})`,
          backdropFilter: backdrop,
          WebkitBackdropFilter: backdrop,
          boxShadow: [
            '0 18px 40px rgba(0,0,0,0.38)',
            '0 2px 6px rgba(0,0,0,0.2)',
            `inset 0 1px 1px rgba(255,255,255,${isDark ? 0.55 : 0.9})`,
            `inset 0 -1px 1px rgba(255,255,255,${isDark ? 0.18 : 0.4})`,
            `inset 0 0 0 1px rgba(255,255,255,${isDark ? 0.14 : 0.35})`,
            'inset 0 -10px 18px rgba(255,255,255,0.05)',
          ].join(', '),
        }}
      >
        {/* Pastilla de vidrio que se desliza bajo la pestana activa */}
        <motion.div
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 rounded-full"
          initial={false}
          animate={{
            left: `calc(0.375rem + ${activeIndex} * ((100% - 0.75rem) / ${tabs.length}))`,
            width: `calc((100% - 0.75rem) / ${tabs.length})`,
          }}
          transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.10))'
              : 'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.55))',
            boxShadow: [
              '0 4px 14px rgba(0,0,0,0.22)',
              `inset 0 1px 1px rgba(255,255,255,${isDark ? 0.5 : 1})`,
              `inset 0 0 0 1px rgba(255,255,255,${isDark ? 0.16 : 0.5})`,
            ].join(', '),
          }}
        />

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className="relative z-10 flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-full cursor-pointer select-none active:scale-95 transition-transform duration-150"
              style={{ color: active ? ink : inkDim, WebkitTapHighlightColor: 'transparent' }}
            >
              <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.4 : 2} />
              <span className="text-[10px] font-semibold leading-none tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
