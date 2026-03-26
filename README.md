# UK Substation Mapping Tool
### SSEN South England Power Distribution (SEPD) — Proof of Concept v1

A spatial intelligence platform for exploring the SSEN SEPD electricity network. Layers real open data across all voltage levels — 400kV Grid Supply Points down to individual 11kV/LV distribution transformers — with live fault overlays, network capacity headroom, DFES LCT projections, NAFIRS fault history, and an AI safety assistant powered by Anthropic Claude.

---

## Table of Contents

1. [Capability Overview](#capability-overview)
2. [Architecture](#architecture)
3. [Data Sources](#data-sources)
4. [Layer System](#layer-system)
5. [Component Design](#component-design)
6. [Data Processing Pipeline](#data-processing-pipeline)
7. [AI Assistant](#ai-assistant)
8. [Design Decisions](#design-decisions)
9. [Bug Log & Fixes](#bug-log--fixes)
10. [Development Setup](#development-setup)
11. [File Structure](#file-structure)
12. [Licence & Attribution](#licence--attribution)

---

## Capability Overview

| Feature | Detail |
|---|---|
| **Map engine** | React Leaflet v5 + Leaflet 1.9 · CartoDB Dark Matter basemap |
| **Voltage levels** | 400/132kV GSP · 132kV BSP · 33/11kV Primary ESAs · 11/0.4kV LV |
| **Substation count** | ~54,036 LV · 442 Primary ESA boundaries · ~50 GSP/BSP (all SEPD) |
| **Live faults** | SSEN SEPD active outages · exact lat/lng · affected area polygon · customer impact |
| **Headroom data** | Demand & generation RAG per substation (SSEN March 2026) |
| **LCT projections** | DFES 2025: EVs, heat pumps, solar PV, battery storage by ESA — three scenarios |
| **Fault history** | NAFIRS HV records by year per primary substation (Recharts bar chart) |
| **Satellite imagery** | ArcGIS World Imagery minimap + Google Maps Street View link per substation |
| **AI assistant** | Anthropic Claude (image recognition · UK safety standards context · Insight Mode) |
| **Safety reference** | EaWR 1989, ENA Safety Rules, BS EN 50110, HSG85, CDM 2015 and others |

---

## Architecture

```
src/
├── App.jsx                     Root layout, global state (selected substation, panels)
├── App.css                     All styling — dark theme, all component styles (~1,500 lines)
├── main.jsx                    Vite entry point
├── components/
│   ├── MapView.jsx             Map container, layer management, fault markers
│   ├── SubstationSidebar.jsx   4-tab details panel (Details / Headroom / Faults / LCT)
│   ├── OutagePanel.jsx         Live faults bar (bottom-centre) + FaultMapMarkers export
│   ├── ChatBot.jsx             Network Intelligence Assistant (Anthropic API)
│   └── SafetyPanel.jsx         UK safety standards reference drawer
└── data/
    ├── substations.js          Static GSP definitions + voltage/status colour helpers
    └── safetyStandards.js      UK electrical safety standards dataset + AI system prompt

public/                         Static assets — served directly by Vite, fetched lazily
├── headroom-substations.json   Processed SSEN headroom (~1,100 SEPD substations)
├── sepd-primary-boundaries.geojson   442 Primary ESA polygons (simplified)
├── ssen-lv-substations.json    ~54k LV substation points (compacted, processed)
├── dfes-by-primary.json        DFES 2025 LCT projections keyed by normalised primary name
└── dfes-licence.json           DFES 2025 SEPD licence-level totals

scripts/                        Node.js one-off data processors (run to rebuild public/ files)
├── process-ssen.mjs            Reads SSEN CSV → deduplicates → BNG→WGS84 → LV JSON
├── process-dfes.cjs            Reads DFES xlsx → dfes-by-primary.json + dfes-licence.json
├── simplify-geojson.mjs        Douglas-Peucker simplification of ESA polygon GeoJSON
└── read-dfes-v2.cjs            DFES v2 xlsx inspector/reader

manual_data/                    Raw source files (not committed — place here before processing)
├── 20260323_substation_locations_csv.csv
├── 20260324_nafirs_hv_sepd_csv.csv
├── headroom-dashboard-data-march-2026.csv
├── sepd_primarysubstation_esa_2025.geojson
└── ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx
```

**State flow:** `App.jsx` owns `selectedSubstation` and panel open/close state. `MapView.jsx` owns all layer toggle state, fetched data references, and outage data. The sidebar reads `selectedSubstation` only — it never writes to the map. A `flyToRef` populated by a `MapController` child component lets `OutagePanel` trigger animated map pans from outside the MapContainer context.

---

## Data Sources

All datasets are open licence. No API key required for map data.

| Dataset | Source | Licence |
|---|---|---|
| Substation locations (all voltages) | SSEN Open Data Portal | CC BY 4.0 |
| Network headroom / capacity (March 2026) | SSEN Generation Availability & Network Capacity | CC BY 4.0 |
| Primary ESA boundaries (GeoJSON) | SSEN Network Maps Portal | CC BY 4.0 |
| NAFIRS HV fault records | SSEN Open Data | CC BY 4.0 |
| DFES 2025 LCT projections | SSEN Distribution Future Energy Scenarios | CC BY 4.0 |
| Live outages | [robintw/sse_powercuts](https://github.com/robintw/sse_powercuts) — mirrors SSEN live feed | Public |
| Basemap tiles | CartoDB Dark Matter | CC BY 3.0 |
| Satellite imagery (minimap) | ArcGIS World Imagery | Esri Terms |

### Coordinate System

All SSEN source data uses **British National Grid (BNG / OSGB36)**. The LV processing script (`process-ssen.mjs`) converts easting/northing to WGS84 lat/lng using a full 7-parameter Helmert transform (Airy 1830 ellipsoid → GRS80). Parameters: `tx=446.448`, `ty=-125.157`, `tz=542.060`, rotation arcseconds `rx=-0.1502`, `ry=-0.2470`, `rz=-0.8421`, scale `s=20.4894 ppm`. This matches OSTN15-level accuracy for the SEPD region.

---

## Layer System

All layers except static GSPs are fetched lazily on first toggle and cached in component state for instant re-toggle.

### Always Visible — Static GSP Markers

Ten named Grid Supply Points from `src/data/substations.js` rendered as `CircleMarker` elements. Radius 12 for GSPs, coloured by `VOLTAGE_COLORS` (`#FF4444` for 400kV, `#FF9500` for 132kV). These are replaced when the Headroom Markers layer is enabled (richer dataset takes over).

### Toggleable Layers

| Toggle | Data file | Rendered as |
|---|---|---|
| **🗺 Primary Boundaries** | `sepd-primary-boundaries.geojson` | GeoJSON `<Polygon>` — grey fill if no headroom loaded; RAG-coloured fill once headroom enabled |
| **📊 Headroom Markers** | `headroom-substations.json` | `CircleMarker` for GSPs and BSPs only. Primary level shown via shapefile only. |
| **⚡ LV Substations** | `ssen-lv-substations.json` | `MarkerClusterGroup` — ~54k points clustered, chunks loaded to avoid thread blocking |

### Live Faults (OutagePanel toggle)

Fetched from `robintw/sse_powercuts` on GitHub. Filtered to `networkId === 'com.sse.ssepd.sepd'` and `resolved === false` (SEPD only — SHEPD Scotland excluded). Each active fault renders:

- **SVG warning triangle** — orange (HV), yellow (LV), purple (PSI) — `L.divIcon` with inline SVG `<polygon>` and `⚡` glyph. Visually distinct from all circular substation markers.
- **GeoJSON dashed polygon** — translucent fill of the affected area from the `location` field.
- **Popup on click** — reference, name, type, customer count, network type, logged time (elapsed), ETR, engineer ETA, affected postcodes, status message.

Clicking a fault row in the panel calls `flyToRef.current(lat, lng, 14)` to animate the map to that location.

---

## Component Design

### MapView.jsx

Owns all layer state and fetched data. Key sub-components:

**`MapController`** — zero-render child inside `MapContainer`. Uses `useMap()` to write `map.flyTo(lat, lng, zoom)` into `flyToRef.current`. This is the only way to trigger map pans from outside the MapContainer React context without prop-drilling through Leaflet's internal context.

**`BoundaryLayer`** — renders the 442 primary ESA polygons. Builds an NRN lookup map from `headroomData` records. The `key` prop is `boundaries-${headroomData.length}` so the GeoJSON remounts when headroom data loads, re-running `onEachFeature` with a populated NRN map and updating both RAG fill colours and click handlers. Click is always registered regardless of headroom state — falls back to feature properties (`PRIMARY_NAME_2025`, `PRIMARY_NRN_SPLIT`, `GSP_NAME`, `BSP_NAME`, `PRIMARY_VOLTAGE_STEP`) when no headroom record matches.

**`HeadroomMarkers`** — filters to GSP and BSP types only. Primary substations are intentionally excluded here (shown via shapefile instead).

**`LVLayer`** — `MarkerClusterGroup` with `chunkedLoading`, `chunkInterval: 100`, `maxClusterRadius: 40`. Custom cluster icon scales from 28px to 44px by count. Labels collapse `>999` to `Nk` format.

**`StaticSubstationMarkers`** — always visible unless headroom layer is active. Acts as a fallback so the map is never empty before data loads.

### OutagePanel.jsx

Dual-purpose component exported as two named symbols:

- **`default OutagePanel`** — the collapsible bottom-centre bar. Shows HV/LV count badges, customer tally, per-fault rows with click-to-locate.
- **`export FaultMapMarkers`** — rendered inside `MapContainer` in MapView. Receives `outages` and `visible` props from MapView state. Renders markers and polygons inside the Leaflet context.

Fetch uses a `?t=Date.now()` cache-bust querystring to bypass GitHub CDN caching on manual refresh. Auto-refresh uses a 60-second `setInterval` cleared on component unmount.

### SubstationSidebar.jsx

Four-tab panel. Tab content is lazy-loaded where relevant:

| Tab | Content |
|---|---|
| **Details** | Asset metadata, ArcGIS satellite minimap, Google Street View link, photo upload + AI analysis trigger |
| **Headroom** | Demand/generation RAG badges with coloured backgrounds, utilisation bar, fault level, reinforcement notes |
| **Faults** | NAFIRS HV fault history bar chart (Recharts `BarChart`) grouped by year per primary NRN |
| **LCT** | DFES 2025 line charts (EE/HT/FB scenarios) for EVs, heat pumps, solar PV, battery; summary table |

DFES data is loaded once via a module-level cache (`_dfesCache`) shared across all sidebar instances. Primary name matching normalises names by stripping suffixes (`PRIMARY`, `GSP`, `BSP`, `SUBSTATION`) before lookup.

Sidebar header condenses name, type, operator and status into 3 lines with inline badges to maximise vertical space for content tabs.

### ChatBot.jsx — Network Intelligence Assistant

Anthropic Claude API only (`claude-sonnet-4-6`). Configured via `VITE_ANTHROPIC_API_KEY`. Groq and local Ollama were considered and removed — only Anthropic is supported.

**Standard mode** — answers using embedded UK safety standards context from `safetyStandards.js`.

**Insight Mode** — injects the selected substation's live data into the system prompt: voltage, utilisation %, headroom MVA, demand/generation RAG, fault history statistics, active constraints and reinforcement works. Enables dataset-aware Q&A without the user having to copy/paste values.

**Image recognition** — files are `FileReader` base64-encoded and sent as `image_url` content blocks. Default analysis prompt references the substation's voltage and operator for contextualised hazard identification.

Triggered contextually from the sidebar "Ask Safety Assistant" button with a pre-populated question.

---

## Data Processing Pipeline

### LV Substations — `scripts/process-ssen.mjs`

**Input:** `manual_data/20260323_substation_locations_csv.csv` — 267,906 rows (all SSEN regions and voltages).

**Filters applied in order:**
1. `Owner = SEPD` — south England only; excludes SHEPD (Scotland)
2. `Class ∈ {11kV, LV}` — distribution level only
3. `Status = Existing` — excludes proposed and decommissioned
4. Scottish locality guard — secondary filter for any SHEPD rows that slipped through

**Deduplication:** Source CSV had every record exactly twice (43,795 duplicate easting/northing pairs). Deduplicated by composite key `${easting}|${northing}` before conversion.

**BNG → WGS84:** Full Helmert 7-parameter transform. Steps: (1) convert BNG easting/northing to OSGB36 lat/lng on Airy 1830 ellipsoid, (2) apply Helmert shift to WGS84 Cartesian, (3) convert back to lat/lng on GRS80 ellipsoid.

**Output:** `public/ssen-lv-substations.json` — ~54,036 records. Compacted to `{lat, lng, t, n, l, a}` (type, number, locality, area) to minimise payload (~4MB vs ~18MB uncompacted).

### Headroom Data

**Input:** `manual_data/headroom-dashboard-data-march-2026.csv` — 1,139 rows covering GSP, BSP and Primary level for SEPD.

**NRN join key (discovered):** `PRIMARY_NRN_SPLIT` in the GeoJSON (4-digit prefix e.g. `1234`) matches the first 4 characters of the `NRN (South)` field in NAFIRS fault records. 438 of 442 primaries matched (99.1%).

**Output:** `public/headroom-substations.json` — array with demand/generation headroom MVA, RAG status, utilisation %, fault level, reinforcement works, NAFIRS fault counts by year.

### Primary ESA Boundaries

**Input:** `manual_data/sepd_primarysubstation_esa_2025.geojson` — 442 MultiPolygon features. Key properties: `PRIMARY_NRN_SPLIT`, `PRIMARY_NAME_2025`, `PRIMARY_VOLTAGE_STEP`, `GSP_NAME`, `BSP_NAME`.

**Processing:** `scripts/simplify-geojson.mjs` applies Douglas-Peucker tolerance simplification to reduce file size while preserving visual fidelity at zoom 7–14.

**Output:** `public/sepd-primary-boundaries.geojson`

### DFES Projections — `scripts/process-dfes.cjs`

**Input:** `manual_data/ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx` — SEPD licence area, by ESA (v2, ~25MB, SEPD-only extract). Original v1 was 41MB full-UK file; v2 provided to reduce processing time.

**Scenarios processed:** Electric Engagement (EE), Holistic Transition (HT), Falling Behind (FB).

**Technologies:** EV count, EV chargers, domestic/non-domestic heat pumps, solar PV (MW), battery storage (MW) by year (2025–2050).

**Output:** `public/dfes-by-primary.json` (keyed by normalised primary name) + `public/dfes-licence.json` (SEPD totals).

---

## AI Assistant

**Provider:** Anthropic Claude API only (`claude-sonnet-4-6`). Direct browser-to-API call using `anthropic-dangerous-direct-browser-access: true` header and `x-api-key` authentication.

**API key:** Set `VITE_ANTHROPIC_API_KEY=sk-ant-...` in `.env`. Note: Claude.ai web subscription tokens are separate from API billing — a paid API account at console.anthropic.com is required.

**System prompt** (standard mode) includes full text of:
- Electricity at Work Regulations 1989 key regulations
- ENA Safety Rules operational requirements
- BS EN 50110-1:2013 zones and minimum approach distances (MAD) by voltage
- HSG85 safe working practices summary
- ENA TS 41-24 substation access requirements
- CDM 2015 designer duties for electrical infrastructure
- GS(M)R 1996 gas/electrical interface safety

**Insight Mode system prompt additions:**
- Substation name, type, voltage, operator
- Current demand RAG and generation RAG
- Utilisation %, demand headroom MVA, generation headroom MVA
- Fault history: total faults, average per year, peak year, years with data
- Active constraints and reinforcement works

---

## Design Decisions

### Dark Map Theme

CartoDB Dark Matter basemap with matching dark UI (`#0a1220` background, `#0d1117` cards). Network infrastructure data reads better against dark — coloured voltage markers and RAG-coloured polygons have higher contrast, and fault warning triangles stand out immediately.

### Voltage Colour Palette

| Voltage | Colour | Rationale |
|---|---|---|
| 400/132kV GSP | `#FF4444` Red | Highest danger / EHV |
| 132kV BSP | `#FF9500` Amber | High voltage |
| 33kV Primary | `#FFD700` Yellow | Sub-transmission |
| 11kV | `#00E676` Green | Distribution |
| 11/0.4kV LV | `#00BCD4` Teal | Low voltage |

### Marker Shape Language

Circles = substations (all types). Triangles = live faults (exclusively). The SVG equilateral triangle rendered via `L.divIcon` cannot be confused with a substation regardless of colour — resolving the visual collision between orange HV faults and orange BSP markers that would exist if both used circles.

### Layer Loading — Lazy + Cached

LV substations (~4MB), headroom (~80KB) and GeoJSON boundaries (~2MB) are fetched only on first toggle. State lives in `MapView` so subsequent toggles are instant. A `fetchOnce` pattern prevents double-fetching on rapid toggles. This avoids loading ~6MB of JSON on initial page load.

### Primary Substations — Polygons Only, No Dots

Primary substations are shown exclusively as ESA boundary polygons. Showing both a dot and a polygon for 442 primaries would create clutter where the polygon already conveys more useful information (service area extent, RAG fill, GSP/BSP hierarchy). Dots are used for GSPs and BSPs only.

### Headroom and Boundaries Are Independent Toggles

Boundaries show immediately on toggle, rendering grey polygons if headroom isn't loaded. This allows spatial exploration of service areas before committing to loading headroom data. When headroom later loads, the `key={boundaries-${headroomData.length}}` forces GeoJSON remount so `onEachFeature` re-fires with the populated NRN map — polygons recolour and click handlers update to include headroom records without requiring a user action.

### Outage Data Source — GitHub Mirror vs SSEN Direct API

The SSEN direct API (`external.distribution.prd.ssen.co.uk/opendataportal-prd/v4/api/getalloutages`) was initially used. It returned records but had empty postcode fields, making individual fault location impossible without a geocoding step. Replaced with `robintw/sse_powercuts` which mirrors the same SSEN live feed as structured JSON including `latitude`, `longitude`, GeoJSON `location` polygon and `affectedAreas` postcode list — no geocoding required.

### SEPD-Only Filtering

`networkId === 'com.sse.ssepd.sepd'` filters to South England only. SHEPD (Scottish Hydro Electric Power Distribution) data is excluded at every layer:
- LV substations: `Owner = SEPD` filter in processing script
- Headroom markers: source CSV is SEPD headroom dashboard
- Live faults: `SEPD_NETWORK` constant in OutagePanel
- No toggle exists to show SHEPD faults

### z-index Strategy

| Element | z-index |
|---|---|
| Leaflet internal panes | 200–700 |
| Layer controls, legend, outage panel | 1000 |
| Substation sidebar | fixed, out-of-flow |
| Chatbot panel | 8900 |
| Chatbot toggle button | 9000 |

Chatbot was raised to 8900/9000 after being found behind the layer control buttons.

---

## Bug Log & Fixes

### LV substations plotted twice
**Symptom:** ~107k markers rendered; every substation appeared at the same location as a duplicate.
**Root cause:** SSEN source CSV (`20260323_substation_locations_csv.csv`) contained every record exactly twice — 43,795 duplicate easting/northing pairs.
**Fix:** Deduplicate by composite key `${easting}|${northing}` in `process-ssen.mjs` before coordinate conversion. Result: ~107k → ~54,036 records.

---

### Primary ESA boundaries not rendering
**Symptom:** Toggling "Primary Boundaries" showed nothing on the map.
**Root cause:** Render condition was `layers.boundaries && boundaryData && headroomData`. Since headroom is a separate toggle, `headroomData` was `null` if not yet loaded, blocking boundary rendering entirely.
**Fix:** Changed to `layers.boundaries && boundaryData` and passed `headroomData || []` as a safe fallback so boundaries render with or without headroom.

---

### Clicking primary boundaries opened empty sidebar (no headroom data)
**Symptom:** After the boundaries fix, clicking an ESA polygon opened the sidebar but Headroom tab showed "No headroom data available" even when headroom was enabled.
**Root cause:** Stale closure. `BoundaryLayer` mounts when boundaries are first toggled — at that point `headroomData` is `[]`. The `nrnMap` closure captured an empty map. When headroom loaded later, `nrnMap` was never rebuilt because the GeoJSON `key="boundaries"` never changed, so React never remounted the layer and `onEachFeature` never re-ran.
**Fix:** Changed GeoJSON `key` to `boundaries-${headroomData.length}`. Loading headroom changes the count from `0` to `N`, React remounts the GeoJSON, `onEachFeature` re-fires for all 442 features with the correct `nrnMap`, and all click handlers close over real headroom records.

---

### Clicking an ESA polygon showed a large orange/white bounding box
**Symptom:** Clicking any primary boundary polygon displayed a rectangular selection box (the feature's axis-aligned bounding box) in orange and white rather than a polygon outline.
**Root cause:** Browsers apply a default `outline` CSS property to focused SVG `<path>` elements. Leaflet renders GeoJSON polygons as SVG paths; clicking focuses the element, and the browser draws the outline around the SVG bounding rectangle — which for an irregular polygon is a large axis-aligned box.
**Fix:** Added CSS suppressing the focus outline:
```css
.leaflet-interactive:focus,
.leaflet-container path:focus,
.leaflet-overlay-pane path:focus,
.leaflet-overlay-pane svg:focus { outline: none !important; }
```

---

### Clicking ESA polygons stopped working after outline fix
**Symptom:** ESA polygons became unselectable — clicking did nothing.
**Root cause:** Unrelated to the outline CSS. The `onEachFeature` handler had `if (sub) layer.on('click', ...)`, so clicks were only wired when a headroom record matched `sub`. With `headroomData || []` passed as fallback, `nrnMap` was empty and `sub` was always `undefined` — no click handlers were registered.
**Fix:** Removed the guard. Click is always registered. When `sub` is available, passes the full headroom record to `onSelect`. When not, constructs a fallback object from `feature.properties` so the sidebar always opens with available data.

---

### Live faults not appearing on map
**Three compounding root causes:**

1. **`preferCanvas: true`** was set on `MapContainer`. Canvas-rendered layers don't support Leaflet `Popup` (which requires DOM event listeners on elements). Changed to `preferCanvas: false`.

2. **SSEN direct API returned empty postcode fields.** The original source (`getalloutages`) had blank `postcode` values — no locations to plot. Switched to `robintw/sse_powercuts` which provides `latitude`/`longitude` directly.

3. **Geocoding was running inside `FaultMapMarkers`** (inside MapContainer) as an async side-effect. Even if postcodes were populated, the async geocode resolved after the render cycle, leaving markers un-positioned. Moot after source switch, but noted.

---

### Fault markers visually indistinct from GSP/BSP markers
**Symptom:** HV fault markers (orange) were identical in shape and size to BSP substation markers (also orange circles).
**Fix:** Replaced `CircleMarker` fault markers with `Marker` + custom `L.divIcon` rendering an inline SVG equilateral triangle with ⚡ glyph. HV = 28px orange triangle, LV = 22px yellow triangle, PSI = purple. Circles exclusively represent substations; triangles exclusively represent faults.

---

### Chatbot panel rendered behind layer controls
**Symptom:** The Network Intelligence Assistant panel was obscured by the layer toggle buttons in the top-right corner.
**Root cause:** `.chatbot-panel` had `z-index: 1100` and layer controls had `z-index: 1000`. Leaflet map panes create stacking contexts that interfere with `position: fixed` elements in certain browser layouts.
**Fix:** Raised `.chatbot-toggle` to `z-index: 9000` and `.chatbot-panel` to `z-index: 8900`.

---

### Sidebar header consumed too much vertical space
**Symptom:** Four-line header (name, type badge, operator, status each on separate lines) pushed tabs and content below the fold on typical laptop screen heights.
**Fix:** Condensed to three lines — row 1: type badge + close button, row 2: substation name, row 3: operator · ● status inline — recovering ~32px of panel height.

---

## Development Setup

### Prerequisites
- Node.js 18+
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com) (separate from Claude.ai web subscription)

### Install and Run
```bash
cd substation-tool
npm install

# Create .env file with your Anthropic key
echo "VITE_ANTHROPIC_API_KEY=sk-ant-..." > .env

npm run dev
# → http://localhost:5173
```

### Rebuild Processed Data (only needed when source data changes)
```bash
# Rebuild LV substations (~54k points)
node scripts/process-ssen.mjs

# Rebuild headroom + DFES projections
node scripts/process-dfes.cjs

# Re-simplify ESA boundaries GeoJSON
node scripts/simplify-geojson.mjs
```

All output goes to `public/` and is served statically by Vite.

### Build for Production
```bash
npm run build    # → dist/
npm run preview  # preview production build on http://localhost:4173
```

### Environment Variables
| Variable | Required | Description |
|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | Yes (AI features) | Anthropic API key for Claude |

---

## File Structure

```
substation-tool/
├── .env                                    Local env vars (not committed)
├── vite.config.js                          Vite config
├── package.json
├── index.html
├── src/
│   ├── App.jsx                             Root — layout, global state
│   ├── App.css                             All styles (~1,500 lines)
│   ├── main.jsx
│   ├── components/
│   │   ├── MapView.jsx                     Map + all layer logic (~280 lines)
│   │   ├── SubstationSidebar.jsx           4-tab detail panel (~530 lines)
│   │   ├── OutagePanel.jsx                 Live faults bar + map markers (~310 lines)
│   │   ├── ChatBot.jsx                     AI assistant (~300 lines)
│   │   └── SafetyPanel.jsx                 Safety standards reference drawer
│   └── data/
│       ├── substations.js                  10 static GSPs + colour helpers
│       └── safetyStandards.js              7 UK safety standards + AI system prompt
├── public/
│   ├── headroom-substations.json           ~1,100 SEPD substations with headroom data
│   ├── sepd-primary-boundaries.geojson     442 primary ESA polygons (simplified)
│   ├── ssen-lv-substations.json            ~54k LV substation points
│   ├── dfes-by-primary.json                DFES 2025 projections by ESA
│   └── dfes-licence.json                   DFES 2025 SEPD licence totals
├── scripts/
│   ├── process-ssen.mjs
│   ├── process-dfes.cjs
│   ├── simplify-geojson.mjs
│   └── read-dfes-v2.cjs
└── manual_data/                            Raw source files (not committed)
    ├── 20260323_substation_locations_csv.csv
    ├── 20260324_nafirs_hv_sepd_csv.csv
    ├── headroom-dashboard-data-march-2026.csv
    ├── sepd_primarysubstation_esa_2025.geojson
    └── ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx
```

---

## Licence & Attribution

**Application code:** Private / proof of concept.

**Required data attributions for any deployment:**

| Dataset | Attribution |
|---|---|
| SSEN substation locations | © Scottish & Southern Electricity Networks (CC BY 4.0) |
| SSEN headroom / capacity data | © SSEN Generation Availability & Network Capacity, March 2026 (CC BY 4.0) |
| SSEN NAFIRS fault records | © SSEN NAFIRS HV SEPD (CC BY 4.0) |
| SSEN DFES 2025 | © SSEN Distribution Future Energy Scenarios 2025 (CC BY 4.0) |
| Live outages | robintw/sse_powercuts — mirrors SSEN open data feed |
| Basemap | © CARTO · © OpenStreetMap contributors (CC BY 3.0) |
| Satellite imagery | © Esri, Maxar, Earthstar Geographics |

**Safety standards referenced in AI context:**
- Electricity at Work Regulations 1989 (EaWR) — UK Parliament / HSE
- ENA Safety Rules — Energy Networks Association
- BS EN 50110-1:2013 Operation of Electrical Installations — BSI / CENELEC
- Gas Safety (Management) Regulations 1996
- Construction (Design and Management) Regulations 2015
- HSG85 Electricity at Work: Safe Working Practices — HSE
- ENA TS 41-24 — Energy Networks Association

---

*Proof of concept — March 2026. SEPD licence area only. All capacity and utilisation data is indicative, sourced from SSEN published open data.*
