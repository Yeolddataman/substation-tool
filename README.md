# UK Substation Mapping Tool
### SSEN South England Power Distribution (SEPD) — Proof of Concept v1

A spatial intelligence platform for exploring the SSEN SEPD electricity network. Layers real open data across all voltage levels — 400kV Grid Supply Points down to individual 11kV/LV distribution transformers — with live fault overlays, fault risk forecasting, network capacity headroom, DFES LCT projections, NAFIRS fault history, and an AI safety assistant powered by Anthropic Claude.

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
| **Live faults** | SSEN SEPD active outages · exact lat/lng · affected area polygon · customer impact · ETR |
| **Fault risk forecast** | 3-day RAG forecast per primary · Open-Meteo weather × NAFIRS fault rate · Z-score sigmoid ML model · LOYO CV ρ = 0.815 · map overlay |
| **Fault history** | NAFIRS HV records 2015–2025 by year per primary substation (Recharts bar chart) |
| **CML tracking** | Customer Minutes Lost ranking across active faults — 24hr restoration timeline with complaints risk badges (propensity-weighted expected complaint count per fault) |
| **Complaints risk** | Per-fault expected complaints = customers × hrs × 0.0025 × propensity index · LSOA demographic propensity from ONS Census 2021 / geographic proxy |
| **ML model transparency** | Model tab showing LOYO cross-validation metric, training coverage, RAG thresholds, fitted formula |
| **GSP filter** | Independent toggle to show/hide 400/132kV GSP markers without affecting the headroom layer |
| **Headroom data** | Demand & generation RAG per substation (SSEN March 2026) |
| **LCT projections** | DFES 2025: EVs, heat pumps, solar PV, battery storage by ESA — three scenarios |
| **Satellite imagery** | ArcGIS World Imagery minimap + Google Maps Street View link per substation |
| **AI assistant** | Anthropic Claude (image recognition · UK safety standards context · Insight Mode) |
| **Safety reference** | EaWR 1989, ENA Safety Rules, BS EN 50110, HSG85, CDM 2015 and others |
| **Authentication** | JWT-based login · bcrypt password hashing · rate-limited login and AI endpoints |

---

## Architecture

```
src/
├── App.jsx                     Root layout, global state (selected substation, panels, outage data)
├── App.css                     All styling — dark theme, all component styles (~1,700 lines)
├── main.jsx                    Vite entry point
├── components/
│   ├── MapView.jsx             Map container, layer management, fault map markers
│   ├── SubstationSidebar.jsx   5-tab details panel (Details / Headroom / LCT / Demand / Quality)
│   ├── OutagePanel.jsx         Named exports only: FaultMapMarkers + FaultTimeline (with complaints risk)
│   ├── FaultsPanel.jsx         Left-side drawer — 5 tabs: Live / CML / History / Forecast / Model
│   ├── ChatBot.jsx             Network Intelligence Assistant (Anthropic API)
│   ├── SafetyPanel.jsx         UK safety standards reference drawer
│   ├── DataQualityPage.jsx     Data quality full-page overlay
│   └── LoginScreen.jsx         Authentication screen + data attribution
└── lib/
    ├── auth.js                 JWT token storage + retrieval helpers
    └── forecast.js             Client-side 1-hour cache for fault forecast data

public/                         Static assets — served directly by Vite, fetched lazily
├── headroom-substations.json   Processed SSEN headroom (~1,100 SEPD substations with NAFIRS fault counts)
├── sepd-primary-boundaries.geojson   442 Primary ESA polygons (simplified)
├── ssen-lv-substations.json    ~54k LV substation points (compacted, processed)
├── demand-profiles.json        Smart meter counts (household proxy) per primary NRN
├── dfes-by-primary.json        DFES 2025 LCT projections keyed by normalised primary name
├── dfes-licence.json           DFES 2025 SEPD licence-level totals
└── lsoa-primary-complaints.json  Per-primary complaint propensity index (422 primaries)

server/
└── index.mjs                   Express backend — JWT auth, Anthropic API proxy, fault forecast API

scripts/                        Node.js one-off data processors (run to rebuild public/ files)
├── process-ssen.mjs            Reads SSEN CSV → deduplicates → BNG→WGS84 → LV JSON
├── process-dfes.cjs            Reads DFES xlsx → dfes-by-primary.json + dfes-licence.json
├── simplify-geojson.mjs        Douglas-Peucker simplification of ESA polygon GeoJSON
├── setup-credentials.mjs       Interactive credential setup — generates bcrypt hash + JWT secret
├── read-dfes-v2.cjs            DFES v2 xlsx inspector/reader
├── validate-model.mjs          ML model validation — year-on-year autocorrelation, LOYO CV, permutation test
├── generate-complaints-seed.mjs  Builds lsoa-primary-complaints.json from geographic proxy (no Census download needed)
└── process-lsoa-complaints.mjs   Full Census 2021 LSOA pipeline — ONS Nomis API + point-in-polygon spatial join

manual_data/                    Raw source files (not committed — place here before processing)
├── 20260323_substation_locations_csv.csv
├── 20260324_nafirs_hv_sepd_csv.csv
├── headroom-dashboard-data-march-2026.csv
├── sepd_primarysubstation_esa_2025.geojson
└── ssen-dfes-2025-results-by-licence-area-and-esav2.xlsx
```

**State flow:** `App.jsx` owns `selectedSubstation`, panel open/close state, `outageData`, `showFaultsOnMap`, `forecastData`, `forecastDay`, and `forecastOverlayActive`. `MapView.jsx` owns all layer toggle state and fetched GeoJSON/headroom/LV data. The sidebar reads `selectedSubstation` only — it never writes to the map. A `flyToRef` callback wired through `onFlyToReady` lets `FaultsPanel` trigger animated map pans from outside the MapContainer context.

---

## Data Sources

All datasets are open licence. No API key required for map or weather data.

| Dataset | Source | Licence |
|---|---|---|
| Substation locations (all voltages) | SSEN Open Data Portal | CC BY 4.0 |
| Network headroom / capacity (March 2026) | SSEN Generation Availability & Network Capacity | CC BY 4.0 |
| Primary ESA boundaries (GeoJSON) | SSEN Network Maps Portal | CC BY 4.0 |
| NAFIRS HV fault records | SSEN Open Data | CC BY 4.0 |
| DFES 2025 LCT projections | SSEN Distribution Future Energy Scenarios | CC BY 4.0 |
| Live outages | [robintw/sse_powercuts](https://github.com/robintw/sse_powercuts) — mirrors SSEN live feed | Public |
| Weather forecast (fault risk model) | [Open-Meteo](https://open-meteo.com) — free, no key required | CC BY 4.0 |
| Complaint propensity (seed) | ONS Census 2021 regional socioeconomic profiles (age, NS-SEC, education, digital confidence) — geographic Gaussian proxy | OGL v3 |
| Complaint propensity (full pipeline) | ONS Nomis API — Census 2021 TS007A, TS062, TS067, TS041 at LSOA level; LSOA 2021 Population Weighted Centroids (ONS Geography Portal) | OGL v3 |
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
| **🗺 Primary Boundaries** | `sepd-primary-boundaries.geojson` | GeoJSON `<Polygon>` — grey fill if no headroom loaded; demand RAG-coloured once headroom enabled; fault risk RAG-coloured when forecast overlay is active |
| **📊 Headroom Markers** | `headroom-substations.json` | `CircleMarker` for GSPs and BSPs only. Primary level shown via shapefile only. |
| **⚡ LV Substations** | `ssen-lv-substations.json` | `MarkerClusterGroup` — ~54k points clustered, chunks loaded to avoid thread blocking |

### Live Faults (FaultsPanel)

Opened via the **⚡ Faults** header button. Fetched from `robintw/sse_powercuts` on GitHub. Filtered to `networkId === 'com.sse.ssepd.sepd'` and `resolved === false` (SEPD only — SHEPD Scotland excluded). Each active fault renders:

- **SVG warning triangle** — orange (HV), yellow (LV), purple (PSI) — `L.divIcon` with inline SVG `<polygon>` and `⚡` glyph. Visually distinct from all circular substation markers.
- **GeoJSON dashed polygon** — translucent fill of the affected area from the `location` field.
- **Popup on click** — reference, name, type, customer count, network type, logged time (elapsed), ETR, engineer ETA, affected postcodes, status message.

Clicking a fault row in the panel calls the `onLocate` flyTo callback to animate the map to that location.

### Fault Risk Forecast Overlay

Enabled via the toggle in the FaultsPanel Forecast tab. When active, primary ESA polygon fills are overridden with forecast RAG colours: Green (`#00E676`), Yellow (`#FFD700`), Red (`#FF4444`). Day selector allows switching between Today / Tomorrow / Day 3. The `BoundaryLayer` component detects the presence of `forecastData` and applies forecast styles over demand RAG styles.

---

## Component Design

### MapView.jsx

Owns all layer state and fetched GeoJSON/headroom/LV data. Receives `outageData`, `showFaultsOnMap`, `forecastData`, `forecastDay`, and `onFlyToReady` from `App.jsx`. Key sub-components:

**`MapController`** — zero-render child inside `MapContainer`. Uses `useMap()` to write `map.flyTo(lat, lng, zoom)` into `flyToRef.current`. This is the only way to trigger map pans from outside the MapContainer React context without prop-drilling through Leaflet's internal context. Exposed to the parent via `onFlyToReady` callback.

**`BoundaryLayer`** — renders the 442 primary ESA polygons. Builds an NRN lookup map from `headroomData` records. The `key` prop is `boundaries-${headroomData.length}-${forecastData ? forecastDay : 'none'}` so the GeoJSON remounts when headroom loads or forecast day changes, re-running `onEachFeature` and `style` with updated data. Click is always registered — falls back to `feature.properties` when no headroom record matches. When `forecastData` is present, polygon fill colours are overridden by the forecast RAG for that primary.

**`HeadroomMarkers`** — filters to GSP and BSP types only (further filtered by `showGSP` prop). Primary substations are intentionally excluded here (shown via shapefile instead).

**`StaticSubstationMarkers`** — accepts `showGSP` prop; filters out type `'GSP'` entries when `showGSP` is false. Provides a map-empty fallback before data loads.

**GSP layer toggle** — `showGSP` state in `MapView` controls GSP marker visibility independently of the headroom layer. A dashed sub-button in `LayerControls` (inside the Headroom Markers control) toggles it. The `Legend` dims the GSP entry and shows "(hidden)" when off.

**`LVLayer`** — `MarkerClusterGroup` with `chunkedLoading`, `chunkInterval: 100`, `maxClusterRadius: 40`. Custom cluster icon scales from 28px to 44px by count. Labels collapse `>999` to `Nk` format.

**`StaticSubstationMarkers`** — always visible unless headroom layer is active. Acts as a fallback so the map is never empty before data loads.

### OutagePanel.jsx

Named exports only (no default export):

- **`FaultMapMarkers`** — rendered inside `MapContainer` in MapView. Receives `outages` and `visible` props passed down from App state. Renders SVG warning-triangle markers and dashed affected-area polygons inside the Leaflet context.
- **`FaultTimeline`** — 24-hour restoration timeline sorted by CML (Customer Minutes Lost = customers × minutes to ETR). Rendered in the FaultsPanel CML tab. Accepts `complaintsData` prop; when present, adds a coloured RAG complaints-risk badge per fault row (expected complaints count + propensity multiplier) and a **Complaints Risk** summary section (total expected complaints, highest-risk fault reference, nearest primary name, formula footnote). `findNearestPrimary()` matches each fault's lat/lng to the nearest primary centroid in `lsoa-primary-complaints.json` by Euclidean distance.

### FaultsPanel.jsx

Left-side slide-in drawer, opened via **⚡ Faults** in the header. Five tabs:

| Tab | Content |
|---|---|
| **Live** | Fault fetch controls (refresh / auto-refresh / map toggle), HV/LV/PSI count badges, per-fault rows with CML, ETR, click-to-locate |
| **CML** | `FaultTimeline` — 24hr restoration bar chart sorted by Customer Minutes Lost; complaints risk badges per row; total CML + complaints risk summary section |
| **History** | NAFIRS HV fault history bar chart (Recharts `BarChart`) per year for the selected primary substation |
| **Forecast** | 3-day weather summary (`WeatherCards` — RAG badge, wind mph bar, rain bar, optional snow row, temperature); site-specific or network-average when no primary selected; day selector; map overlay toggle |
| **Model** | ML model transparency card — LOYO CV metric (coloured badge: Strong/Moderate/Weak), training coverage grid, weather feature weights, fitted formula, RAG threshold boxes |

`complaintsData` state loads `/lsoa-primary-complaints.json` lazily on first CML tab open. Forecast data fetched on Forecast or Model tab open via `fetchForecast()` (client-side 1-hour cache). Outage data fetched on panel open and auto-refreshed every 60 seconds when enabled.

**`WeatherCards`** — 3-column grid (Today / Tomorrow / Day+2) with:
- RAG badge (icon + label) derived from dominant forecast RAG across all primaries that day
- Wind bar in mph (blue <25mph, yellow <44mph, red ≥44mph) — converted from km/h using `kphToMph`
- Rain bar (mm, green)
- Snow row rendered only when any day has snowfall
- Temperature in °C with colour gradient (icy blue → teal → amber → orange)

### SubstationSidebar.jsx

Five-tab panel opened when a substation or primary ESA is selected on the map:

| Tab | Content |
|---|---|
| **Details** | Asset metadata, ArcGIS satellite minimap, Google Street View link, photo upload + AI analysis trigger |
| **Headroom** | Demand/generation RAG badges, utilisation bar, fault level, reinforcement notes |
| **LCT** | DFES 2025 line charts (EE/HT/FB scenarios) for EVs, heat pumps, solar PV, battery; summary table |
| **Demand** | Secondary substation demand rankings within the ESA |
| **Quality** | LV substation count within ESA boundary, data completeness indicators |

DFES data is loaded once via a module-level cache (`_dfesCache`) shared across all sidebar instances. Primary name matching normalises names by stripping suffixes (`PRIMARY`, `GSP`, `BSP`, `SUBSTATION`) before lookup.

### server/index.mjs

Express backend serving the built Vite frontend and proxying AI requests. Endpoints:

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/auth/login` | None (rate limited 10/hr) | Validates credentials, returns signed JWT (8h expiry) |
| `POST /api/chat` | JWT required | Proxies to Anthropic API — caller supplies own key via `X-Anthropic-Key` header |
| `GET /api/fault-forecast` | JWT required | Returns 3-day fault risk RAG per primary — 1-hour server-side cache |
| `GET /api/health` | None | Health check |

**Fault forecast model — Z-score sigmoid regression (`buildMLModel()`):**
1. Reads `public/headroom-substations.json`. For each primary with ≥ 3 years of NAFIRS fault history, computes average annual fault rate per feeder across training years (all years except the most recent two).
2. Standardises rates to Z-scores (μ, σ across all primaries). Applies sigmoid: `vuln = 0.60 + sigmoid((rate − μ) / σ) × 0.90` → vulnerability in [0.60, 1.50].
3. Validation (see `scripts/validate-model.mjs`): Leave-one-year-out cross-validation across all 11 NAFIRS years; mean Spearman ρ = 0.815 ± 0.020. Held-out test ρ = 0.836. Permutation test p < 0.001. Better than naive constant-mean baseline.
4. Each primary is assigned to the nearest of 12 weather zones covering SEPD.
5. Open-Meteo fetches wind gusts, precipitation, snowfall, max temperature for 3 days ahead (12 HTTP requests per refresh).
6. Weather risk score: `gusts×0.55 + rain×0.25 + snow×0.20 + temp_extreme×0.10`, capped at 1.0.
7. Final score = weather score × vulnerability. RAG thresholds: Green < 0.20, Yellow 0.20–0.45, Red ≥ 0.45.
8. Response includes `modelMeta` (LOYO ρ, training years, test years, μ, σ) displayed in the Model tab.
9. Cache warmed on startup; refreshed hourly on demand.

### ChatBot.jsx — Network Intelligence Assistant

Anthropic Claude API only (`claude-sonnet-4-6`). Calls proxied through `POST /api/chat` — API key supplied by user via UI, forwarded in `X-Anthropic-Key` header, never stored server-side.

**Standard mode** — answers using embedded UK safety standards context from `safetyStandards.js`.

**Insight Mode** — injects the selected substation's live data into the system prompt: voltage, utilisation %, headroom MVA, demand/generation RAG, fault history statistics, active constraints and reinforcement works. Enables dataset-aware Q&A without the user having to copy/paste values.

**Image recognition** — files are `FileReader` base64-encoded and sent as `image_url` content blocks. Default analysis prompt references the substation's voltage and operator for contextualised hazard identification.

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

**NAFIRS join:** `20260324_nafirs_hv_sepd_csv.csv` — 38,551 HV fault records. Grouped by `NRN (South)` field (4-digit prefix), counting faults per year 2015–2025. These per-year counts (`faultsByYear`) and total feeder count (`feederCount`) are embedded into each primary's headroom record for use by the fault risk model and NAFIRS history chart.

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

### Complaint Propensity Data — Geographic Seed

**`scripts/generate-complaints-seed.mjs`** (no external data download needed):

1. Loads `headroom-substations.json`, `demand-profiles.json`, `sepd-primary-boundaries.geojson`.
2. Builds `nrnToGSP` lookup from `GSP_NAME` field in the boundary GeoJSON.
3. Applies a GSP-level propensity lookup table (18 named GSP areas, range 0.78–1.44) calibrated to ONS Census 2021 regional socioeconomic profiles (age distribution, NS-SEC, education, digital confidence per Ofgem CAM weights).
4. Falls back to a bivariate Gaussian propensity field for primaries not covered by the GSP table — validated Surrey ~1.42, E Kent ~1.03, IoW ~0.80, Dorset ~0.90.
5. Normalises all values so mean propensity = 1.0 across the 422 covered primaries.
6. **Output:** `public/lsoa-primary-complaints.json` — schema: `{ meta: { baseRate: 0.0025, coverage: 422, ... }, primaries: { [nrn]: { name, lat, lng, gspArea, propensityIndex, meters, feederCount, demandRAG } } }`.

**`scripts/process-lsoa-complaints.mjs`** (full Census 2021 pipeline, ~5–10 min):

1. Fetches LSOA 2021 population weighted centroids from ONS Geography Portal WFS.
2. Calls ONS Nomis API for Census 2021 tables at LSOA level: TS007A (age), TS062 (NS-SEC), TS067 (education), TS041 (households).
3. Computes CAM propensity per LSOA: `age×0.30 + nssec×0.30 + education×0.20 + digital×0.20`.
4. Performs point-in-polygon spatial join of LSOA centroids against `sepd-primary-boundaries.geojson`.
5. Aggregates to primary level using household-weighted mean propensity.
6. Normalises to mean = 1.0; overwrites the seed file with full LSOA-derived data.

**Base rate calibration:** 0.0025 complaints per customer per hour at propensity = 1.0. Source: Ofgem Electricity Distribution Quality of Service Report 2024 (15–25 complaints per 1,000 customers per major 4–8hr HV outage).

---

## AI Assistant

**Provider:** Anthropic Claude API only (`claude-sonnet-4-6`). Requests are proxied through the Express backend (`POST /api/chat`) — the API key is supplied by the user in the chat UI, forwarded in the `X-Anthropic-Key` header, and never stored or logged server-side.

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

### Faults Panel — Consolidated Drawer

All fault-related content (live faults, CML timeline, NAFIRS history, forecast) is consolidated into a single left-side `FaultsPanel` drawer rather than scattered across the bottom bar, map overlays and sidebar tabs. This reduces UI clutter and allows fault context to persist while the right-side substation sidebar is open.

### Outage Data Source — GitHub Mirror vs SSEN Direct API

The SSEN direct API (`external.distribution.prd.ssen.co.uk/opendataportal-prd/v4/api/getalloutages`) was initially used. It returned records but had empty postcode fields, making individual fault location impossible without a geocoding step. Replaced with `robintw/sse_powercuts` which mirrors the same SSEN live feed as structured JSON including `latitude`, `longitude`, GeoJSON `location` polygon and `affectedAreas` postcode list — no geocoding required.

### SEPD-Only Filtering

`networkId === 'com.sse.ssepd.sepd'` filters to South England only. SHEPD (Scottish Hydro Electric Power Distribution) data is excluded at every layer:
- LV substations: `Owner = SEPD` filter in processing script
- Headroom markers: source CSV is SEPD headroom dashboard
- Live faults: `SEPD_NETWORK` constant in OutagePanel
- No toggle exists to show SHEPD faults

### Fault Risk Model — Z-score Sigmoid vs Percentile Buckets

The original model sorted primaries into four percentile bands and applied a fixed vulnerability multiplier per band (0.60, 0.85, 1.15, 1.50). This created artificial cliffs at quartile boundaries — two primaries with nearly identical fault rates but straddling the 75th percentile were assigned very different vulnerabilities.

The replacement Z-score sigmoid is continuous: `vuln = 0.60 + sigmoid((rate − μ) / σ) × 0.90`. Output range is identical [0.60, 1.50]. The sigmoid is monotone, so Spearman ρ is unchanged by the transformation — the value is in better-calibrated mid-range scores and no boundary artefacts. Validated via `scripts/validate-model.mjs` (LOYO ρ = 0.815, permutation p < 0.001).

### Fault Risk Model — Weather Zones vs Per-Substation Fetch

Fetching weather for each of 454 primaries individually would mean 454 Open-Meteo API calls per hourly refresh — wasteful and slow. Instead, 12 weather zones cover the entire SEPD footprint (4 columns × 3 rows at 0.5° resolution). Each primary is assigned to its nearest zone by Euclidean distance in lat/lng space. This reduces weather fetches to 12 per refresh while keeping geographic granularity well within the spatial variance of UK weather systems (~50km zone diameter vs typical frontal scales of hundreds of km).

### Complaints Risk — Nearest-Primary Spatial Join at Runtime

For each live fault, `findNearestPrimary()` matches `o.latitude / o.longitude` to the closest primary centroid in `lsoa-primary-complaints.json` by Euclidean distance in lat/lng space. This is a fast O(n) scan over ~422 primaries — well within budget for a UI render. An alternative was a pre-built spatial index, but given the small dataset size and infrequent call pattern (only on CML tab open), a linear scan is simpler and more maintainable. The nearest primary is a good proxy for the fault's ESA because HV faults occur within the primary's supply area by definition.

### z-index Strategy

| Element | z-index |
|---|---|
| Leaflet internal panes | 200–700 |
| Layer controls, legend | 1000 |
| FaultsPanel, SafetyPanel | 99 (flex siblings, no z-index needed) |
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

### Fault forecast: "Cannot read properties of undefined (reading 'time')"
**Symptom:** `/api/fault-forecast` returned 502 with this error on first request.
**Root cause:** Open-Meteo returned an error response object (no `daily` field) for one or more weather zones — typically due to transient network or rate-limit conditions. The code attempted `.daily.time` on the error object.
**Fix:** Added `.catch(() => null)` to each zone fetch. After all fetches resolve, find the first zone with valid `daily.time` data. If none exist, throw a descriptive error with a sample of the response. Replace any null zones with the nearest valid zone's data so partial failures degrade gracefully.

---

## Development Setup

### Prerequisites
- Node.js 18+
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com) (separate from Claude.ai web subscription)

### Install and Run (Development)

```bash
cd substation-tool
npm install

# Set up authentication credentials (interactive — generates bcrypt hash + JWT secret)
npm run setup-creds

# Start the backend API server (port 3001)
npm run dev:server

# In a second terminal, start the Vite frontend dev server (port 5173)
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api` requests to `localhost:3001` automatically.

### Rebuild Processed Data (only needed when source data changes)
```bash
# Rebuild LV substations (~54k points)
node scripts/process-ssen.mjs

# Rebuild headroom + DFES projections
node scripts/process-dfes.cjs

# Re-simplify ESA boundaries GeoJSON
node scripts/simplify-geojson.mjs

# Rebuild complaint propensity seed (geographic proxy — no Census download needed)
node scripts/generate-complaints-seed.mjs

# Replace seed with full Census 2021 LSOA data (~5-10 min, hits ONS Nomis API)
node scripts/process-lsoa-complaints.mjs

# Validate the ML fault risk model (standalone — no server required)
node scripts/validate-model.mjs
```

All output goes to `public/` and is served statically by Vite.

### Build and Run for Production

```bash
npm run build    # → dist/
npm run server   # serves dist/ + API on :3001
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_USERNAME` | Yes | Login username |
| `AUTH_PASSWORD_HASH` | Yes | bcrypt hash of the login password — generated by `npm run setup-creds` |
| `JWT_SECRET` | Yes | 48-byte hex secret for signing JWT tokens — generated by `npm run setup-creds` |

All variables are read from `.env` at server startup. Run `npm run setup-creds` to generate them interactively.

---

## File Structure

```
substation-tool/
├── .env                                    Local env vars (not committed)
├── vite.config.js                          Vite config — dev proxy /api → :3001
├── package.json
├── index.html
├── src/
│   ├── App.jsx                             Root — layout, global state (~170 lines)
│   ├── App.css                             All styles (~1,700 lines)
│   ├── main.jsx
│   ├── components/
│   │   ├── MapView.jsx                     Map + all layer logic (~330 lines)
│   │   ├── SubstationSidebar.jsx           5-tab detail panel (~750 lines)
│   │   ├── OutagePanel.jsx                 FaultMapMarkers + FaultTimeline exports (~315 lines)
│   │   ├── FaultsPanel.jsx                 Left-side faults drawer, 5 tabs (~520 lines)
│   │   ├── ChatBot.jsx                     AI assistant (~300 lines)
│   │   ├── SafetyPanel.jsx                 Safety standards reference drawer
│   │   ├── DataQualityPage.jsx             Data quality full-page overlay
│   │   └── LoginScreen.jsx                 Login form + data attribution
│   ├── lib/
│   │   ├── auth.js                         JWT token helpers (get/set/clear)
│   │   └── forecast.js                     Forecast fetch with 1-hour client cache
│   └── data/
│       ├── substations.js                  10 static GSPs + colour helpers
│       └── safetyStandards.js              7 UK safety standards + AI system prompt
├── server/
│   └── index.mjs                           Express backend — auth, AI proxy, forecast API (~400 lines)
├── public/
│   ├── headroom-substations.json           ~1,100 SEPD substations with headroom + NAFIRS data
│   ├── sepd-primary-boundaries.geojson     442 primary ESA polygons (simplified)
│   ├── ssen-lv-substations.json            ~54k LV substation points
│   ├── demand-profiles.json                Smart meter counts per primary NRN
│   ├── lsoa-primary-complaints.json        Complaint propensity index per primary (422 primaries)
│   ├── dfes-by-primary.json                DFES 2025 projections by ESA
│   └── dfes-licence.json                   DFES 2025 SEPD licence totals
├── scripts/
│   ├── process-ssen.mjs
│   ├── process-dfes.cjs
│   ├── simplify-geojson.mjs
│   ├── setup-credentials.mjs
│   ├── read-dfes-v2.cjs
│   ├── validate-model.mjs                  ML model validation (standalone, no server needed)
│   ├── generate-complaints-seed.mjs        Geographic proxy seed for complaint propensity data
│   └── process-lsoa-complaints.mjs         Full Census 2021 LSOA pipeline (requires ONS Nomis API)
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
| Weather forecast | © Open-Meteo contributors (CC BY 4.0) — open-meteo.com |
| Complaint propensity data | © Office for National Statistics, Census 2021 (OGL v3) — via ONS Nomis API and ONS Geography Portal |
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
