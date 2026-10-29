# IntroDB CORS proxy (VIDAA Pages build)

`api.introdb.app` only allows its own site (`https://introdb.app`) as a browser
origin. Tizen and webOS run Nuvio as packaged apps and can read it; the VIDAA
build runs as a web page on GitHub Pages, so the TV's browser drops every
answer and Skip Intro never appears.

This Cloudflare Worker forwards exactly `GET /segments` with the parameters
Nuvio sends (`imdb_id` + `season`/`episode`, or `is_movie=true`), only for the
origins in `segmentsRequest.mjs`, and caches answers for 6 hours, so IntroDB
gets one request per title instead of one per viewer. Everything else gets 400,
403 or 405. It runs on the free Workers plan (100,000 requests per day).

Live: `https://nuvio-introdb-proxy.kvnshroom.workers.dev` (Cloudflare account
kvnshroom@gmail.com).

```bash
npx wrangler login                                          # once
npx wrangler dev --config tools/introdb-proxy/wrangler.toml # local test
npx wrangler deploy --config tools/introdb-proxy/wrangler.toml
node tests/test-introdb-proxy.mjs                           # unit test
```

The Pages workflow uses it when the repository variable `INTRODB_PROXY_URL` is
set (it writes `INTRODB_API_URL` into the build's `local.properties`). Packaged
Tizen/webOS builds keep talking to IntroDB directly.

**Remove it** once IntroDB allows these origins: unset `INTRODB_PROXY_URL` in
both repositories and run `npx wrangler delete --config tools/introdb-proxy/wrangler.toml`.
