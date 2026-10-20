import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  BACKEND_ORIGIN: { public: false, static: false, schema: (value) => value ?? '' },
  API_PROXY_SECRET: { public: false, static: false, schema: (value) => value ?? '' },
  API_ORIGIN: { public: true, static: true, schema: (value) => value ?? '' },
  CARD_ASSET_ORIGIN: { public: true, static: true, schema: (value) => value ?? '' },
  GOOGLE_ANALYTICS_ID: { public: true, static: true, schema: (value) => value ?? '' },
});
