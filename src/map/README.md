Query to get the lines.geojson on https://overpass-turbo.eu/

```
[out:json][timeout:180];

// First, zoom out until you can see Jundiai, Barueri and nearby cities

// 1. Find physical tracks in the CURRENT VIEW (bbox)
way({{bbox}})["railway"~"rail|subway|light_rail|monorail"]->.tracks;

// 2. Find the parent Route Relations for these tracks
rel(bw.tracks)["type"="route"]->.candidates;

// 3. Filter: Keep only the specific SP networks
(
  rel.candidates["network"~"CPTM|Metr[oó]|ViaMobilidade|ViaQuatro", i];
  rel.candidates["operator"~"CPTM|Metr[oó]|ViaMobilidade|ViaQuatro", i];
)->.clean_routes;

// 4. Output ONLY the Relation Geometry
// This output mode creates the lines but DOES NOT fetch the individual station nodes.
.clean_routes out geom;
```

Building a minimized lines.geojson for the app

- Keep the unedited export as `src/map/original_lines.geojson` (not shipped).
- Run the compressor to produce the minimized file used in the app:

```
npm run compress:lines
```

What the script does:

- Reads `src/map/original_lines.geojson`.
- Keeps only geometry and the properties used by the app: `ref` and `colour`/`color`.
- Rounds all coordinates to 5 decimal places (~1.1 m) to reduce size.
- Writes minified JSON to `src/map/lines.geojson` and reports size savings.
