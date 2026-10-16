interface Env {
  ALLOWED_ORIGIN: string
  GEOAPIFY_API_KEY?: string
}

interface NominatimResult {
  lat?: string
  lon?: string
  name?: string
  display_name?: string
}

interface OverpassElement {
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number }
  tags?: Record<string, string>
}

interface GeoapifySuggestion {
  lat?: number
  lon?: number
  name?: string
  formatted?: string
  address_line1?: string
  address_line2?: string
}

interface GeoapifyPlace {
  properties?: {
    lat?: number
    lon?: number
    name?: string
    formatted?: string
    address_line2?: string
    distance?: number
  }
  geometry?: { coordinates?: number[] }
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }
const appHeaders = { Accept: 'application/json', 'User-Agent': 'NavGo/0.1 (interactive navigation app)' }

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } })
}

function corsHeaders(origin: string, allowedOrigin: string): HeadersInit {
  const isAllowed = origin === allowedOrigin
  return {
    ...(isAllowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '86400',
  }
}

function parseCoordinatePair(value: string | null): [number, number] | null {
  if (!value) return null
  const parts = value.split(',')
  if (parts.length !== 2) return null
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return [lat, lon]
}

function unavailable(service: string, status: number) {
  if (status === 429) return `${service} is rate-limited right now. Wait a little and try again.`
  return `${service} is temporarily unavailable. Please try again in a moment.`
}

function cachedHeaders(seconds = 300): HeadersInit {
  return { 'cache-control': `public, max-age=${seconds}, s-maxage=${seconds}` }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, headers)
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Origin not allowed.' }, 403, headers)

    if (url.pathname === '/api/suggest') {
      const query = (url.searchParams.get('q') ?? '').trim()
      if (query.length < 3 || query.length > 180) return json({ suggestions: [] }, 200, headers)
      if (!env.GEOAPIFY_API_KEY) return json({ error: 'Suggestions are unavailable. You can still submit the full destination.' }, 503, headers)

      const upstreamUrl = new URL('https://api.geoapify.com/v1/geocode/autocomplete')
      upstreamUrl.searchParams.set('text', query)
      upstreamUrl.searchParams.set('format', 'json')
      upstreamUrl.searchParams.set('limit', '6')
      upstreamUrl.searchParams.set('apiKey', env.GEOAPIFY_API_KEY)
      try {
        const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json' } })
        if (!upstream.ok) {
          const message = upstream.status === 429
            ? 'Suggestions are rate-limited. You can still submit the destination.'
            : 'Suggestions are unavailable right now. You can still submit the destination.'
          return json({ error: message }, upstream.status === 429 ? 429 : 502, headers)
        }
        const payload = await upstream.json() as { results?: GeoapifySuggestion[] }
        const suggestions = (payload.results ?? [])
          .filter((item) => typeof item.lat === 'number' && typeof item.lon === 'number')
          .map((item) => ({
            name: item.name || item.address_line1 || item.formatted || query,
            detail: item.address_line2 || item.formatted || '',
            lat: item.lat as number,
            lon: item.lon as number,
          }))
        return json({ suggestions }, 200, { ...headers, ...cachedHeaders(60) })
      } catch {
        return json({ error: 'Suggestions are temporarily unreachable. You can still submit the destination.' }, 502, headers)
      }
    }

    if (url.pathname === '/api/search') {
      const query = (url.searchParams.get('q') ?? '').trim()
      if (query.length < 2 || query.length > 180) return json({ error: 'Enter a search between 2 and 180 characters.' }, 400, headers)

      const upstreamUrl = new URL('https://nominatim.openstreetmap.org/search')
      upstreamUrl.searchParams.set('q', query)
      upstreamUrl.searchParams.set('format', 'jsonv2')
      upstreamUrl.searchParams.set('limit', '1')
      try {
        const upstream = await fetch(upstreamUrl, { headers: appHeaders })
        if (!upstream.ok) return json({ error: unavailable('OpenStreetMap search', upstream.status) }, upstream.status === 429 ? 429 : 502, headers)
        const results = await upstream.json() as NominatimResult[]
        const result = results[0]
        const lat = Number(result?.lat)
        const lon = Number(result?.lon)
        if (!result || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          return json({ error: `No places found for “${query}”. Try adding a city or country.` }, 404, headers)
        }
        return json({ name: result.name || result.display_name || query, lat, lon }, 200, { ...headers, ...cachedHeaders(300) })
      } catch {
        return json({ error: 'Could not reach OpenStreetMap search. Check your connection and try again.' }, 502, headers)
      }
    }

    if (url.pathname === '/api/places') {
      const categoryKey = url.searchParams.get('category') ?? ''
      const categoryFilters: Record<string, string> = {
        coffee: '"amenity"="cafe"',
        park: '"leisure"="park"',
        restaurant: '"amenity"="restaurant"',
        shops: '"shop"',
      }
      const center = parseCoordinatePair(url.searchParams.get('center'))
      const filter = categoryFilters[categoryKey]
      if (!filter) return json({ error: 'Choose coffee, park, or restaurant.' }, 400, headers)
      if (!center) return json({ error: 'Set a starting point first: click the map or use your current location.' }, 400, headers)

      const [lat, lon] = center
      if (env.GEOAPIFY_API_KEY) {
        const geoapifyCategories: Record<string, string> = {
          coffee: 'catering.cafe',
          park: 'leisure.park',
          restaurant: 'catering.restaurant',
          shops: 'commercial',
        }
        const placesUrl = new URL('https://api.geoapify.com/v2/places')
        placesUrl.searchParams.set('categories', geoapifyCategories[categoryKey])
        placesUrl.searchParams.set('filter', `circle:${lon},${lat},5000`)
        placesUrl.searchParams.set('bias', `proximity:${lon},${lat}`)
        placesUrl.searchParams.set('limit', '20')
        placesUrl.searchParams.set('apiKey', env.GEOAPIFY_API_KEY)
        try {
          const upstream = await fetch(placesUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
          if (upstream.ok) {
            const payload = await upstream.json() as { features?: GeoapifyPlace[] }
            const places = (payload.features ?? []).flatMap((feature) => {
              const properties = feature.properties
              const coordinates = feature.geometry?.coordinates
              const placeLat = typeof properties?.lat === 'number' ? properties.lat : coordinates?.[1]
              const placeLon = typeof properties?.lon === 'number' ? properties.lon : coordinates?.[0]
              if (typeof placeLat !== 'number' || typeof placeLon !== 'number') return []
              return [{
                name: properties?.name || `${categoryKey[0].toUpperCase()}${categoryKey.slice(1)}`,
                detail: properties?.address_line2 || properties?.formatted || '',
                lat: placeLat,
                lon: placeLon,
                distance: properties?.distance ?? distanceBetween(lat, lon, placeLat, placeLon),
              }]
            }).sort((a, b) => a.distance - b.distance).slice(0, 20)
            if (places.length) return json({ places, provider: 'Geoapify' }, 200, { ...headers, ...cachedHeaders(300) })
          }
        } catch {
          // Fall through to OpenStreetMap's public Overpass endpoint.
        }
      }
      const query = `[out:json][timeout:15];(nwr[${filter}](around:5000,${lat},${lon}););out center 40;`
      const upstreamUrl = new URL('https://overpass-api.de/api/interpreter')
      upstreamUrl.searchParams.set('data', query)
      try {
        const upstream = await fetch(upstreamUrl, { headers: appHeaders, signal: AbortSignal.timeout(18000) })
        if (!upstream.ok) return json({ error: unavailable('Nearby places search', upstream.status) }, upstream.status === 429 ? 429 : 502, headers)
        const payload = await upstream.json() as { elements?: OverpassElement[] }
        const places = (payload.elements ?? []).flatMap((element) => {
          const placeLat = element.lat ?? element.center?.lat
          const placeLon = element.lon ?? element.center?.lon
          if (typeof placeLat !== 'number' || typeof placeLon !== 'number') return []
          const tags = element.tags ?? {}
          const categoryName = categoryKey === 'coffee' ? 'Coffee shop' : categoryKey === 'park' ? 'Park' : categoryKey === 'shops' ? 'Shop' : 'Restaurant'
          const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ')
          return [{
            name: tags.name || categoryName,
            detail: address || tags.cuisine || '',
            lat: placeLat,
            lon: placeLon,
            distance: distanceBetween(lat, lon, placeLat, placeLon),
          }]
        }).sort((a, b) => a.distance - b.distance)
        const uniquePlaces = places.filter((place, index, all) => all.findIndex((other) => other.lat === place.lat && other.lon === place.lon) === index).slice(0, 20)
        if (!uniquePlaces.length) {
          return json({ error: `No ${categoryKey} places found within 5 km. Try another starting point.` }, 404, headers)
        }
        return json({ places: uniquePlaces, provider: 'OpenStreetMap' }, 200, { ...headers, ...cachedHeaders(300) })
      } catch {
        return json({ error: 'Nearby places search timed out. Please try again.' }, 502, headers)
      }
    }

    if (url.pathname === '/api/route') {
      const start = parseCoordinatePair(url.searchParams.get('start'))
      const end = parseCoordinatePair(url.searchParams.get('end'))
      if (!start || !end) return json({ error: 'Provide valid start and destination points.' }, 400, headers)

      const [startLat, startLon] = start
      const [endLat, endLon] = end
      const upstreamUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}`)
      upstreamUrl.searchParams.set('overview', 'full')
      upstreamUrl.searchParams.set('geometries', 'geojson')
      try {
        const upstream = await fetch(upstreamUrl, { headers: appHeaders, signal: AbortSignal.timeout(15000) })
        if (!upstream.ok) return json({ error: unavailable('Route service', upstream.status) }, upstream.status === 429 ? 429 : 502, headers)
        const payload = await upstream.json() as {
          code?: string
          routes?: { geometry?: { coordinates?: [number, number][] }; distance?: number; duration?: number }[]
        }
        const route = payload.routes?.[0]
        if (payload.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
          return json({ error: 'No driving route was found. Try another start point or destination.' }, 404, headers)
        }
        return json({ coordinates: route.geometry.coordinates, distance: route.distance ?? 0, duration: route.duration ?? 0 }, 200, headers)
      } catch {
        return json({ error: 'Route service timed out. Please try again.' }, 502, headers)
      }
    }

    return json({ error: 'Not found.' }, 404, headers)
  },
}

function distanceBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const deltaLat = radians(lat2 - lat1)
  const deltaLon = radians(lon2 - lon1)
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}
