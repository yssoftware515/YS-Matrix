import type { Metadata } from 'next';
import { Orbitron, Rajdhani, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';
import { Providers } from './providers';
import { Toaster } from 'react-hot-toast';

// ============================================================
// Fonts — next/font/google self-hosts these at build time (no
// external request to fonts.googleapis.com, no layout shift, and
// resolves @next/next/no-page-custom-font since we're no longer
// injecting a raw <link> into <head>). Each font exposes its family
// under the SAME CSS variable name globals.css already references
// (--font-display / --font-body / --font-mono), so no CSS changes
// needed beyond removing the now-redundant :root fallback values.
// ============================================================
const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});
const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

// ============================================================
// YS-MATRIX ERP - Root Metadata (SEO + PWA + OpenGraph)
// YS Systems & Software
// ============================================================
export const metadata: Metadata = {
  title: 'YS-MATRIX ERP',
  description: 'YS-MATRIX ERP — Powered by YS Systems & Software',

  // Required for relative OG image URLs to resolve correctly
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  ),

  // PWA manifest
  manifest: '/manifest.json',

  // Favicon + Apple touch icon
  icons: {
    icon:  '/icon.webp',
    apple: '/icon.webp',
  },

  // OpenGraph — controls how the link looks when shared
  // on WhatsApp, Telegram, Twitter, LinkedIn, etc.
  openGraph: {
    title:       'YS-MATRIX ERP SYSTEM',
    description: 'نظام إدارة المعارض والمخزون الذكي - بتطوير من YS Systems & Software',
    url:         '/',
    siteName:    'YS-MATRIX',
    images: [
      {
        url:    '/opengraph.webp',
        width:  1200,
        height: 630,
        alt:    'YS-MATRIX ERP Banner',
      },
    ],
    locale: 'ar_EG',
    type:   'website',
  },

  // Twitter/X card — previously missing, links shared without
  // OG fallback were rendering as plain text (AS-05)
  twitter: {
    card:        'summary_large_image',
    title:       'YS-MATRIX ERP SYSTEM',
    description: 'نظام إدارة المعارض والمخزون الذكي - بتطوير من YS Systems & Software',
    images:      ['/opengraph.webp'],
  },
};

// ============================================================
// Root Layout
// ============================================================
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${orbitron.variable} ${rajdhani.variable} ${jetbrainsMono.variable}`}
    >
      <body suppressHydrationWarning>
        <Providers>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background:  '#071220',
                color:       '#C8E6F5',
                border:      '1px solid #0D2137',
                fontFamily:  'var(--font-body)',
                fontSize:    '14px',
              },
              success: {
                iconTheme: { primary: '#00FF88', secondary: '#020408' },
              },
              error: {
                iconTheme: { primary: '#FF2D55', secondary: '#020408' },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
