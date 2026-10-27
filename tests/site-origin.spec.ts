import { expect, test } from '@playwright/test';

test('metadata, discovery files and socket policy follow the deployment origin', async ({
  request,
}) => {
  const target = process.env.TEST_SITE_URL || 'http://127.0.0.1:5173';
  const port = new URL(target).port;
  for (const hostname of ['cards-one.localhost', 'cards-two.localhost']) {
    const host = `${hostname}${port ? `:${port}` : ''}`;
    const origin = `http://${host}`;
    const publicOrigin = process.env.TEST_SITE_ORIGIN || origin;
    const headers = { Host: host };
    const page = await request.get(`${target}/reglas?invitation=private`, { headers });
    expect(page.ok()).toBe(true);
    const html = await page.text();
    expect(html).toContain(`property="og:url" content="${publicOrigin}/reglas"`);
    expect(html).toContain(`property="og:image" content="${publicOrigin}/og-image.png"`);
    // Static pages carry CSP in a meta tag; dynamic pages use a response header.
    const policy = page.headers()['content-security-policy'] || html;
    expect(policy).toContain(publicOrigin.replace(/^http/, 'ws'));

    const robots = await request.get(`${target}/robots.txt`, { headers });
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain(`Sitemap: ${publicOrigin}/sitemap.xml`);
    const sitemap = await request.get(`${target}/sitemap.xml`, { headers });
    expect(sitemap.ok()).toBe(true);
    expect(sitemap.headers()['content-type']).toMatch(/^(application|text)\/xml\b/);
    const xml = await sitemap.text();
    for (const path of ['/', '/reglas', '/creditos']) {
      expect(xml).toContain(`<loc>${publicOrigin}${path}</loc>`);
    }
    expect(xml).not.toContain('/mesa/');
  }
});
