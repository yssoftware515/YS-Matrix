'use client';

// ============================================================
// YS-MATRIX ERP — Cinematic Splash Screen
// YS Systems & Software
//
// Shared loading state used by both the root entry point
// (app/page.tsx) and the dashboard shell (DashboardLayout).
// Extracted to avoid duplicating the same markup in two places.
// ============================================================

import Image from 'next/image';

interface Props {
  label?: string;
}

export function SplashScreen({ label }: Props) {
  return (
    <div
      style={{ minHeight: '100vh', backgroundColor: '#020408' }}
      className="relative flex flex-col items-center justify-center gap-4 overflow-hidden"
    >
      <div className="absolute inset-0 bg-grid opacity-20 pointer-events-none" />

      <Image
        src="/loading.webp"
        alt="YS-MATRIX"
        width={96}
        height={96}
        priority
        className="relative z-10 object-contain animate-pulse-slow"
        style={{ filter: 'drop-shadow(0 0 20px rgba(0,212,255,0.5))' }}
      />

      {label && (
        <p
          className="relative z-10 text-xs text-matrix-subtle tracking-[0.3em] uppercase"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          {label}
        </p>
      )}
    </div>
  );
}
