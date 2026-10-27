import { SITE_ORIGIN } from '$app/env/public';
import type { RequestHandler } from './$types';

export const prerender = Boolean(SITE_ORIGIN);

export const GET: RequestHandler = ({ url }) => {
  const origin = (SITE_ORIGIN || url.origin).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const entries = ['/', '/reglas', '/creditos']
    .map((path) => `  <url><loc>${origin}${path}</loc></url>`)
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
