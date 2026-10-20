import { GOOGLE_ANALYTICS_ID } from '$app/env/public';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let initialized = false;

function tag(...parameters: unknown[]) {
  if (parameters.length === 0) return;
  window.dataLayer ??= [];
  // Google tag commands use an arguments object, as in the official bootstrap.
  // eslint-disable-next-line prefer-rest-params -- Preserve gtag.js's documented command format.
  window.dataLayer.push(arguments);
}

export function trackPage(pathname: string) {
  if (!/^G-[A-Z0-9]+$/.test(GOOGLE_ANALYTICS_ID)) return;

  // Invitation codes and URL queries must never reach analytics.
  const path = pathname.startsWith('/mesa/') ? '/mesa' : pathname;
  const location = `${window.location.origin}${path}`;

  if (!initialized) {
    initialized = true;
    tag('js', new Date());
    tag('config', GOOGLE_ANALYTICS_ID, {
      send_page_view: false,
      page_location: location,
      page_referrer: '',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`;
    document.head.append(script);
  }

  tag('set', { page_location: location, page_referrer: '' });
  tag('event', 'page_view', {
    page_location: location,
    page_referrer: '',
    page_title: path === '/mesa' ? 'Mesa — Retruco' : document.title,
  });
}
