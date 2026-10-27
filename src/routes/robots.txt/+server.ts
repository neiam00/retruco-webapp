import { SITE_ORIGIN } from '$app/env/public';
import type { RequestHandler } from './$types';

export const prerender = Boolean(SITE_ORIGIN);

export const GET: RequestHandler = ({ url }) =>
  new Response(
    `User-agent: *\nAllow: /\nDisallow: /mesa/\nSitemap: ${SITE_ORIGIN || url.origin}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
