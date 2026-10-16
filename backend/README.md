# NavGo API

The Cloudflare Worker provides four read-only endpoints:

- `GET /api/suggest?q=...` returns address/place suggestions from Geoapify Autocomplete (requires a server-side `GEOAPIFY_API_KEY`).
- `GET /api/search?q=...` searches destinations with OpenStreetMap Nominatim.
- `GET /api/places?category=coffee|park|restaurant|shops&center=lat,lon` returns up to 20 Geoapify places, with Overpass as a fallback.
- `GET /api/route?start=lat,lon&end=lat,lon` requests a driving route from OSRM.

Autocomplete and nearby places need a Geoapify key in `backend/.dev.vars` (`GEOAPIFY_API_KEY=...`). Geoapify currently documents a free plan with 3,000 credits per day; autocomplete calls cost 1 credit each and returning up to 20 places costs 1 credit. The key stays in the Worker and is never sent to the browser. Nominatim search, Overpass fallback, and OSRM routing do not need keys, but their public services have fair-use limits and no uptime guarantees. Nominatim allows at most one request per second per application; NavGo calls it only after the user submits a search, not while typing. Overpass instances may be busy or rate-limit requests. OSRM's demo server is for reasonable, non-commercial use, at most one request per second. For a public/high-traffic launch, choose hosted providers or operate your own services.

Suggestions are debounced while the user types and nearby results and routes are only requested after the user acts. Responses include cache hints. Keep visible OpenStreetMap attribution on the map and Geoapify attribution near the map. Review the service policies before launch:

- https://operations.osmfoundation.org/policies/nominatim/
- https://operations.osmfoundation.org/policies/tiles/
- https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
- https://project-osrm.org/docs/v26.6.1/api/

## Local development

Copy `backend/.dev.vars.example` to `backend/.dev.vars` and add your Geoapify key if the local key file is not already configured. From `frontend/`, run `npm run dev`. The script starts Wrangler on port 8788 and Vite on port 5173; Vite forwards `/api` requests to the Worker. Search and routing can still run without the key, but autocomplete will be unavailable and nearby search will use the slower Overpass fallback.

## Deploy the Worker

1. From `backend/`, run `npx wrangler login`.
2. Update `ALLOWED_ORIGIN` in `wrangler.jsonc` to the deployed frontend's exact origin.
3. Set the key with `npx wrangler secret put GEOAPIFY_API_KEY`.
4. Run `npm run deploy` and copy the Worker URL.
5. Set `VITE_API_BASE_URL=https://<your-worker>.<your-account>.workers.dev/api` in the frontend hosting environment, then rebuild and deploy the frontend.

Before a public launch, add request rate limiting and monitoring, and confirm that the public community endpoints are appropriate for the expected traffic.
