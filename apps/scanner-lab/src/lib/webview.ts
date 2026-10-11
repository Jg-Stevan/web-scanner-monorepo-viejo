/**
 * FIX v13 (13.4) — Detección de WebViews de redes sociales.
 *
 * Instagram/Facebook/TikTok (y otras apps) abren los enlaces en un WebView
 * propio donde `getUserMedia` no existe o falla silenciosamente: el usuario
 * queda atrapado sin saber que la causa es la app contenedora. Con el UA se
 * detecta el contenedor y la UI puede dar la salida REAL: abrir en Safari
 * (iPhone) o Chrome (Android), o usar la importación desde galería.
 */

/** Patrones UA de WebViews sociales conocidos (orden irrelevante). */
const SOCIAL_WEBVIEW_PATTERN =
  /\b(FBAV|FBAN|FB_IAB|FBMD|Instagram(?:\s|\/|$)|musical_ly|BytedanceWebview|TikTok|Line|LinkedIn|Snapchat)\b/i;

/**
 * ¿El UA parece el WebView de una red social (no un navegador real)?
 * False en Safari/Chrome/Firefox normales, true dentro de apps sociales.
 */
export function isSocialWebView(ua: string): boolean {
  if (!ua) return false;
  return SOCIAL_WEBVIEW_PATTERN.test(ua);
}
