export function buildControlUiCspHeader(opts?: {
  cortexUrl?: string;
  supabaseUrl?: string;
  aiIntranetUrl?: string;
}): string {
  // Control UI: block framing, block inline scripts, keep styles permissive
  // (UI uses a lot of inline style attributes in templates).

  // Allow the Cortex, Supabase, and AI Intranet origins so the login flow can call their APIs.
  let connectSrc = "'self' ws: wss:";
  for (const url of [opts?.cortexUrl, opts?.supabaseUrl, opts?.aiIntranetUrl]) {
    if (url) {
      try {
        const origin = new URL(url).origin;
        connectSrc += ` ${origin}`;
      } catch {
        // Invalid URL — skip, don't break CSP.
      }
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
  ].join("; ");
}
