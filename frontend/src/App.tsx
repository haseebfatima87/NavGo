import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

type Place = { name: string; detail?: string; lat: number; lon: number; distance?: number }
type Route = { coordinates: [number, number][]; distance: number; duration: number }
type PlaceCategory = 'coffee' | 'park' | 'restaurant' | 'shops'
type SuggestionResponse = { suggestions: Place[] }
type NearbyResponse = { places: Place[] }
type NearbyIntent = { category: PlaceCategory; areaQuery: string }

const startIcon = L.divIcon({ className: 'navgo-marker start-marker', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] })
const destinationIcon = L.divIcon({ className: 'navgo-marker destination-marker', html: '<span></span>', iconSize: [32, 40], iconAnchor: [16, 37] })
const initialCenter: LatLngExpression = [20, 0]
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api'

async function apiGet<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`)
  } catch {
    throw new Error('NavGo API is not running. Start the app with npm run dev from the frontend folder.')
  }
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null
  if (!response.ok) {
    throw new Error(payload?.error || `NavGo API returned ${response.status}. Check that the backend is running.`)
  }
  if (!payload) throw new Error('NavGo API returned an unreadable response. Check that the backend is running.')
  return payload
}

function nearbyIntentFor(query: string): NearbyIntent | null {
  const categories: { category: PlaceCategory; pattern: RegExp }[] = [
    { category: 'coffee', pattern: /\b(?:coffee\s*shops?|coffee|caf[eé]s?)\b/gi },
    { category: 'restaurant', pattern: /\b(?:restaurants?|dining|food)\b/gi },
    { category: 'park', pattern: /\b(?:parks?|gardens?)\b/gi },
    { category: 'shops', pattern: /\b(?:shops?|stores?|shopping|malls?|supermarkets?|groceries)\b/gi },
  ]
  const match = categories.find((item) => item.pattern.test(query))
  if (!match) return null
  const areaQuery = query
    .replace(match.pattern, ' ')
    .replace(/\b(?:in|near|around|nearby|at|the|of|best|good)\b/gi, ' ')
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { category: match.category, areaQuery }
}

function MapActions({ onPickOrigin }: { onPickOrigin: (point: [number, number]) => void }) {
  const map = useMap()
  useMapEvents({ click: (event) => onPickOrigin([event.latlng.lat, event.latlng.lng]) })
  return (
    <div className="map-controls glass" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" onClick={() => map.zoomIn()}>+</button>
      <span className="control-divider" />
      <button type="button" aria-label="Zoom out" onClick={() => map.zoomOut()}>−</button>
    </div>
  )
}

function MapFocus({ place, places, origin, route }: { place: Place | null; places: Place[]; origin: [number, number] | null; route: Route | null }) {
  const map = useMap()
  useEffect(() => {
    const compact = map.getSize().x <= 720
    if (route?.coordinates.length) {
      const bottomPadding = compact ? Math.min(460, Math.round(map.getSize().y * 0.72)) : 90
      map.fitBounds(route.coordinates, {
        paddingTopLeft: compact ? [20, 75] : [390, 100],
        paddingBottomRight: compact ? [20, bottomPadding] : [90, 90],
        maxZoom: 15,
        animate: true,
      })
    } else if (places.length > 1) {
      const bounds = L.latLngBounds(places.map((item) => [item.lat, item.lon]))
      map.fitBounds(bounds, {
        paddingTopLeft: compact ? [18, 75] : [390, 100],
        paddingBottomRight: compact ? [18, Math.min(460, Math.round(map.getSize().y * 0.72))] : [90, 90],
        maxZoom: 15,
        animate: true,
      })
    } else if (place || places[0]) {
      const destination = place || places[0]
      map.flyTo([destination.lat, destination.lon], 14, { duration: 0.8 })
    } else if (origin) {
      map.flyTo(origin, 14, { duration: 0.8 })
    }
  }, [map, origin, place, places, route])
  return null
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [destination, setDestination] = useState('')
  const [quickCategory, setQuickCategory] = useState<PlaceCategory | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [nearbyPlaces, setNearbyPlaces] = useState<Place[]>([])
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionError, setSuggestionError] = useState('')
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionEnabled, setSuggestionEnabled] = useState(true)
  const [origin, setOrigin] = useState<[number, number] | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const nearbyResultsRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (nearbyPlaces.length) nearbyResultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [nearbyPlaces.length])

  useEffect(() => {
    const query = destination.trim()
    if (!suggestionEnabled || quickCategory || query.length < 3 || nearbyIntentFor(query)) {
      setSuggestions([])
      setSuggestionsLoading(false)
      setSuggestionError('')
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true)
      setSuggestionError('')
      void apiGet<SuggestionResponse>(`/suggest?q=${encodeURIComponent(query)}`)
        .then((result) => { if (active) { setSuggestions(result.suggestions); setSuggestionsLoading(false) } })
        .catch((error: unknown) => { if (active) { setSuggestions([]); setSuggestionsLoading(false); setSuggestionError(error instanceof Error ? error.message : 'Suggestions unavailable.') } })
    }, 450)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [destination, quickCategory, suggestionEnabled])

  async function requestRoute(target: Place) {
    if (!origin) {
      setRoute(null)
      setMessage('Destination selected. Set a starting point to see the route.')
      return
    }
    const params = new URLSearchParams({ start: origin.join(','), end: `${target.lat},${target.lon}` })
    const routeData = await apiGet<Route>(`/route?${params}`)
    const coordinates: [number, number][] = routeData.coordinates.map(([lng, lat]: [number, number]) => [lat, lng])
    setRoute({ coordinates, distance: routeData.distance, duration: routeData.duration })
    setMessage('Route ready')
  }

  async function searchDestination(query: string, category: PlaceCategory | null, centerOverride?: [number, number]) {
    if (!query || busy) return
    const searchCenter = centerOverride || origin
    if (category && !searchCenter) {
      setMessage('Add a city (like “coffee shops in Hyderabad”) or set a starting point to search nearby places.')
      return
    }
    setBusy(true)
    setSuggestionsOpen(false)
    setMessage(category ? 'Looking for nearby places…' : 'Searching for your destination…')
    setPlace(null)
    setNearbyPlaces([])
    setRoute(null)
    try {
      if (category && searchCenter) {
        const result = await apiGet<NearbyResponse>(`/places?category=${category}&center=${searchCenter.join(',')}`)
        setNearbyPlaces(result.places)
        setMessage(origin
          ? `Found ${result.places.length} places within 5 km. Choose one to see its route.`
          : `Found ${result.places.length} places within 5 km. Set a starting point, then choose a place to route there.`)
      } else {
        const found = await apiGet<Place>(`/search?q=${encodeURIComponent(query)}`)
        setPlace(found)
        if (origin) {
          setMessage('Finding the best driving route…')
          await requestRoute(found)
        } else {
          setMessage('Destination found. Set a starting point to see the route.')
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function choosePlace(selected: Place, source: 'suggestion' | 'nearby') {
    setDestination(selected.name)
    setQuickCategory(null)
    setSuggestionEnabled(false)
    setSuggestions([])
    setSuggestionsOpen(false)
    setPlace(selected)
    if (source === 'suggestion') setNearbyPlaces([])
    setRoute(null)
    setBusy(true)
    setMessage(origin ? 'Finding the best driving route…' : 'Destination selected. Set a starting point to see the route.')
    if (!origin) {
      setBusy(false)
      return
    }
    try {
      await requestRoute(selected)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not calculate this route.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSuggestionEnabled(false)
    const query = destination.trim()
    const intent = nearbyIntentFor(query)
    if (intent && !quickCategory) {
      await searchNearbyIntent(query, intent)
      return
    }
    await searchDestination(query, quickCategory)
  }

  async function searchNearbyIntent(query: string, intent: NearbyIntent) {
    if (!intent.areaQuery) {
      await searchDestination(query, intent.category)
      return
    }
    setBusy(true)
    setSuggestionsOpen(false)
    setMessage(`Finding ${intent.areaQuery}…`)
    try {
      const area = await apiGet<Place>(`/search?q=${encodeURIComponent(intent.areaQuery)}`)
      const center: [number, number] = [area.lat, area.lon]
      setBusy(false)
      await searchDestination(query, intent.category, center)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not find that area.')
      setBusy(false)
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage('Location is not available in this browser. Click the map to set your starting point.')
      return
    }
    setMessage('Getting your location…')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setOrigin([coords.latitude, coords.longitude]); setRoute(null); setMessage(nearbyPlaces.length ? 'Starting point set. Choose a nearby place to get a route.' : 'Starting point set. Search for a destination to get a route.') },
      () => setMessage('Could not get your location. Allow location access or click the map to set a starting point.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function setQuickSearch(query: string, category: PlaceCategory) {
    setDestination(query)
    setQuickCategory(category)
    setSuggestionEnabled(false)
    void searchDestination(query, category)
  }

  const routeSummary = route
    ? `${Math.round(route.distance / 1000)} km · ${Math.max(1, Math.round(route.duration / 60))} min drive`
    : ''
  const typedNearbyIntent = nearbyIntentFor(destination.trim())

  return (
    <main className={`navgo ${theme}`}>
      <div className="map-background">
        <MapContainer center={initialCenter} zoom={3} zoomControl={false} className="leaflet-map" worldCopyJump>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {origin && <Marker position={origin} icon={startIcon} />}
          {nearbyPlaces.map((nearbyPlace, index) => (
            <Marker key={`${nearbyPlace.lat},${nearbyPlace.lon},${index}`} position={[nearbyPlace.lat, nearbyPlace.lon]} icon={destinationIcon} eventHandlers={{ click: () => { void choosePlace(nearbyPlace, 'nearby') } }} />
          ))}
          {place && !nearbyPlaces.some((item) => item.lat === place.lat && item.lon === place.lon) && <Marker position={[place.lat, place.lon]} icon={destinationIcon} />}
          {route && <Polyline positions={route.coordinates} pathOptions={{ color: '#77c848', weight: 7, opacity: .9 }} />}
          <MapFocus place={place} places={nearbyPlaces} origin={origin} route={route} />
          <MapActions onPickOrigin={(point) => { setOrigin(point); setRoute(null); setMessage(nearbyPlaces.length ? 'Starting point set. Choose a nearby place to get a route.' : 'Starting point set. Search for a destination to get a route.') }} />
        </MapContainer>
      </div>

      <header className="topbar glass">
        <a className="brand" href="#" aria-label="NavGo home"><span className="brand-icon">N</span><span>navgo<span className="brand-period">.</span></span></a>
        <div className="topbar-status"><span className="status-dot" /> OpenStreetMap navigation</div>
        <button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle colour theme" type="button">{theme === 'dark' ? '☀' : '☾'}</button>
      </header>

      <aside className="sidebar glass">
        <div className="eyebrow">YOUR NEXT ADVENTURE</div>
        <h1>Where to<br />next<span className="brand-period">?</span></h1>
        <p className="intro">Find your way. Enjoy the journey.</p>

        <form className="search-form" onSubmit={handleSearch}>
          <label htmlFor="destination">DESTINATION</label>
          <div className="search-input-wrap"><span className="search-icon">⌕</span><input id="destination" autoComplete="off" value={destination} onFocus={() => { setSuggestionEnabled(true); setSuggestionsOpen(true) }} onChange={(event) => { setDestination(event.target.value); setQuickCategory(null); setSuggestionEnabled(true); setSuggestionsOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setSuggestionsOpen(false) }} placeholder="Search a place or address" aria-autocomplete="list" aria-expanded={suggestionsOpen && suggestions.length > 0} aria-controls="destination-suggestions" /></div>
          {suggestionsOpen && destination.trim().length >= 3 && (suggestions.length > 0 || suggestionsLoading || suggestionError) && (
            <div className="suggestions-list" id="destination-suggestions" role="listbox" aria-label="Destination suggestions">
              {suggestions.map((suggestion, index) => (
                <button className="suggestion-item" type="button" role="option" aria-selected="false" key={`${suggestion.lat},${suggestion.lon},${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { void choosePlace(suggestion, 'suggestion') }}>
                  <span className="suggestion-pin">⌖</span><span className="suggestion-copy"><strong>{suggestion.name}</strong><small>{suggestion.detail}</small></span>
                </button>
              ))}
              {suggestionsLoading && <div className="suggestions-hint">Finding places…</div>}
              {!suggestionsLoading && suggestionError && <div className="suggestions-hint">{suggestionError} Press Enter to search.</div>}
              {!suggestionsLoading && !suggestionError && suggestions.length === 0 && <div className="suggestions-hint">No suggestions. Press Enter to search.</div>}
              <div className="suggestion-credit">Suggestions by Geoapify</div>
            </div>
          )}
          {suggestionsOpen && typedNearbyIntent && destination.trim().length >= 3 && (
            <div className="suggestions-list" role="listbox" aria-label="Nearby place search">
              <button className="suggestion-item" type="button" role="option" aria-selected="false" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => { void searchNearbyIntent(destination.trim(), typedNearbyIntent) }}>
                <span className="suggestion-pin">⌖</span><span className="suggestion-copy"><strong>Search {typedNearbyIntent.category === 'coffee' ? 'coffee shops' : typedNearbyIntent.category === 'restaurant' ? 'restaurants' : typedNearbyIntent.category === 'park' ? 'parks' : 'shops'}{typedNearbyIntent.areaQuery ? ` in ${typedNearbyIntent.areaQuery}` : ' nearby'}</strong><small>Show places on the map</small></span>
              </button>
              <div className="suggestion-credit">Powered by Geoapify Places</div>
            </div>
          )}
          <button className="search-button" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Explore route'} <span>↗</span></button>
        </form>

        <button className="location-button" type="button" onClick={useMyLocation}>◎ <span>Use my current location</span></button>
        {message && (
          <div className="destination-result" role="status">
            <span className="result-icon">{route ? '↗' : nearbyPlaces.length ? '⌖' : '⌖'}</span>
            <div>
              <span className="result-caption">{route ? 'ROUTE' : nearbyPlaces.length ? 'NEARBY PLACES' : place ? 'DESTINATION' : 'NAVIGATION'}</span>
              <strong>{route ? place?.name || message : nearbyPlaces.length ? `${nearbyPlaces.length} places found` : place?.name || (busy ? 'Please wait' : message)}</strong>
              {route && <p>{routeSummary}</p>}
              {!route && <p>{message}</p>}
            </div>
          </div>
        )}

        {nearbyPlaces.length > 0 && (
          <section className="nearby-results" aria-label="Nearby places" ref={nearbyResultsRef}>
            <div className="section-heading"><span>NEARBY RESULTS</span><span className="small-muted">{nearbyPlaces.length} PLACES</span></div>
            <div className="nearby-list">
              {nearbyPlaces.map((nearbyPlace, index) => (
                <button className="nearby-item" type="button" key={`${nearbyPlace.lat},${nearbyPlace.lon},${index}`} disabled={busy} onClick={() => { void choosePlace(nearbyPlace, 'nearby') }}>
                  <span className="nearby-number">{index + 1}</span><span className="nearby-copy"><strong>{nearbyPlace.name}</strong><small>{nearbyPlace.detail || 'OpenStreetMap place'} · {(Number(nearbyPlace.distance || 0) / 1000).toFixed(1)} km</small></span><span className="place-arrow">↗</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="sidebar-divider" />
        <div className="section-heading"><span>QUICK DESTINATIONS</span><span className="small-muted">SEARCH</span></div>
        <button className="place-item" type="button" disabled={busy} onClick={() => setQuickSearch('Coffee shops', 'coffee')}><span className="place-icon">☕</span><span className="place-copy"><strong>Coffee shops</strong><small>Take a little break</small></span><span className="place-arrow">↗</span></button>
        <button className="place-item" type="button" disabled={busy} onClick={() => setQuickSearch('Nearby parks', 'park')}><span className="place-icon green">♧</span><span className="place-copy"><strong>Nearby parks</strong><small>Find your calm</small></span><span className="place-arrow">↗</span></button>
        <button className="place-item" type="button" disabled={busy} onClick={() => setQuickSearch('Restaurants', 'restaurant')}><span className="place-icon orange">♨</span><span className="place-copy"><strong>Restaurants</strong><small>Something delicious</small></span><span className="place-arrow">↗</span></button>
        <button className="place-item" type="button" disabled={busy} onClick={() => setQuickSearch('All shops', 'shops')}><span className="place-icon">⌑</span><span className="place-copy"><strong>All shops</strong><small>Browse nearby stores</small></span><span className="place-arrow">↗</span></button>
        <div className="sidebar-footer"><span className="footer-avatar">N</span><span><strong>{origin ? 'Starting point ready' : 'Choose a starting point'}</strong><small>Use location access or click the map.</small></span></div>
      </aside>

      <div className="map-caption glass"><span className="caption-dot" /><span>{route ? 'ROUTE DISPLAYED' : nearbyPlaces.length ? `${nearbyPlaces.length} PLACES ON MAP` : 'OPENSTREETMAP'}</span></div>
      <div className="map-credit glass">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · Data © OpenStreetMap</div>
    </main>
  )
}

export default App
