import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  API_ORIGIN: { public: true, static: true, schema: (value) => value ?? '' },
  CARD_ASSET_ORIGIN: { public: true, static: true, schema: (value) => value ?? '' },
  GOOGLE_ANALYTICS_ID: { public: true, static: true, schema: (value) => value ?? '' },
});
