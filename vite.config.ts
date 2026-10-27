import { defineConfig, loadEnv } from 'vite';
import { sveltekit, type Config } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import tailwindcss from '@tailwindcss/vite';

type CspDirectives = NonNullable<NonNullable<Config['csp']>['directives']>;
type CspSource = NonNullable<CspDirectives['connect-src']>[number];

function configuredOrigin(value: string): CspSource {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Configured API and asset URLs must use HTTP or HTTPS.');
  }
  // URL parsing validates the origin before narrowing it to SvelteKit's CSP type.
  return url.origin as CspSource;
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiOrigin = environment.API_ORIGIN;
  const assetOrigin = environment.CARD_ASSET_ORIGIN;
  const siteOrigin = environment.SITE_ORIGIN;
  const connections: CspSource[] = [
    'self',
    'https://*.google-analytics.com',
    'https://challenges.cloudflare.com',
  ];

  if (siteOrigin) {
    connections.push(configuredOrigin(siteOrigin).replace(/^http/, 'ws') as CspSource);
  }

  if (apiOrigin) {
    const origin = configuredOrigin(apiOrigin);
    connections.push(origin, origin.replace(/^http/, 'ws') as CspSource);
  }
  if (mode === 'development') {
    connections.push('ws://127.0.0.1:5173', 'ws://localhost:5173');
  }

  return {
    plugins: [
      tailwindcss(),
      sveltekit({
        adapter: adapter(),
        csp: {
          mode: 'auto',
          directives: {
            'default-src': ['self'],
            'script-src': [
              'self',
              'wasm-unsafe-eval',
              'https://www.googletagmanager.com',
              'https://challenges.cloudflare.com',
            ],
            'frame-src': ['https://challenges.cloudflare.com'],
            'worker-src': ['self'],
            'style-src': ['self', 'unsafe-inline'],
            'img-src': ['self', 'data:', ...(assetOrigin ? [configuredOrigin(assetOrigin)] : [])],
            'connect-src': connections,
            'media-src': ['self', 'blob:'],
            'frame-ancestors': ['none'],
            'base-uri': ['self'],
            'object-src': ['none'],
            'form-action': ['self'],
          },
        },
      }),
    ],
    server: {
      proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true } },
      // Browser screenshots and reports must not invalidate live game sessions.
      watch: { ignored: ['**/output/**', '**/playwright-report/**'] },
    },
  };
});
