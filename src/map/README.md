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