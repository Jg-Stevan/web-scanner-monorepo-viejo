import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Estructura (SPEC-e14-redesign-stitch §1): Inter (TODO el texto,
 *  400–800) + JetBrains Mono (scores, chips, códigos, horas, banner).
 *  Vía next/font/google — 0 peticiones a fonts.googleapis en runtime
 *  (AC12). El Caveat manuscrita del mock NO se porta (§1: la tarjeta
 *  muestra la FOTO del acta, no el formulario dibujado). */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jbmono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Digitalizador E-14 — Precisión electoral",
  description:
    "Digitalizador de actas E-14: escaneo con score de calidad, control de mesas y transmisión verificada.",
  applicationName: "Digitalizador E-14",
  formatDetection: { telephone: false },
  // §12 PWA (SPEC-e14-cyber-neon): pantalla completa sin barras del
  // navegador — standalone + manifest (Next prefija el basePath al servir).
  // SIN service worker ni install-prompt (fuera de alcance de la ronda).
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#070A0D",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Sin viewport-fit=cover iOS no expone env(safe-area-*) (mismo patrón que scanner-lab).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jbmono.variable} antialiased bg-brand-black text-gray-100 font-sans`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
