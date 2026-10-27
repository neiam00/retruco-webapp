import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  SITE_ORIGIN: {
    public: true,
    static: true,
    schema: (value) => {
      if (!value) return '';
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          'SITE_ORIGIN must be an HTTP(S) origin without credentials, path, or query.',
        );
      }
      return url.origin;
    },
  },
  BACKEND_ORIGIN: { public: false, static: false, schema: (value) => value ?? '' },
  API_PROXY_SECRET: { public: false, static: false, schema: (value) => value ?? '' },
  API_ORIGIN: { public: true, static: true, schema: (value) => value ?? '' },
  CARD_ASSET_ORIGIN: { public: true, static: true, schema: (value) => value ?? '' },
  GOOGLE_ANALYTICS_ID: { public: true, static: true, schema: (value) => value ?? '' },
});
