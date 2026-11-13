const FEED_URL = 'https://letterboxd.com/sarath_mohan/rss/';
const CACHE_URL = 'https://letterboxd-rss-proxy.internal/feed';
const CACHE_TTL_SECONDS = 600;
const ALLOWED_ORIGINS = new Set([
  'https://rhlmraj.github.io',
  'http://localhost:5173',
]);

function corsHeaders(origin) {
  const headers = new Headers({ Vary: 'Origin' });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

function textResponse(message, status, origin, extraHeaders = {}) {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
  return new Response(message, { status, headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return textResponse('Origin not allowed', 403, origin);
    }

    if (request.method === 'OPTIONS') {
      if (request.headers.get('Access-Control-Request-Method') !== 'GET') {
        return textResponse('Method not allowed', 405, origin, { Allow: 'GET, OPTIONS' });
      }
      headers.set('Access-Control-Allow-Methods', 'GET');
      headers.set('Access-Control-Max-Age', String(CACHE_TTL_SECONDS));
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'GET') {
      return textResponse('Method not allowed', 405, origin, { Allow: 'GET, OPTIONS' });
    }

    const cache = caches.default;
    const cacheKey = new Request(CACHE_URL);
    let response = await cache.match(cacheKey);

    if (!response) {
      let upstream;
      try {
        upstream = await fetch(FEED_URL, {
          headers: {
            Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
            'User-Agent': 'Movie Poll Letterboxd RSS proxy (rhlmraj/movie-poll)',
          },
        });
      } catch {
        return textResponse('Unable to fetch the Letterboxd feed', 502, origin);
      }

      if (!upstream.ok) {
        return textResponse('Letterboxd feed returned an error', 502, origin);
      }

      const cacheHeaders = new Headers({
        'Content-Type': 'application/xml',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      });
      response = new Response(upstream.body, {
        status: upstream.status,
        headers: cacheHeaders,
      });
      await cache.put(cacheKey, response.clone());
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Content-Type', 'application/xml');
    for (const [name, value] of headers) {
      responseHeaders.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  },
};
