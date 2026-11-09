/*
  Consulta Overpass para el callejero de Cieza (Murcia).
  La usa scripts/import-osm.mjs. También puede pegarse tal cual en https://overpass-turbo.eu
  (Exportar → Datos sin procesar / raw OSM data) si el script no puede conectar.

  Se selecciona la relación administrativa del municipio (admin_level=8, nombre «Cieza»)
  dentro de un rectángulo que la contiene, para no confundirla con otro lugar homónimo.
*/
[out:json][timeout:240];
rel["boundary"="administrative"]["admin_level"="8"]["name"="Cieza"](38.05,-1.75,38.45,-1.15);
map_to_area->.mun;
(
  way["highway"]["name"](area.mun);
  way["highway"]["ref"](area.mun);
  nwr["amenity"~"^(townhall|police|fire_station|hospital|clinic|doctors|school|college|university|kindergarten|library|theatre|arts_centre|community_centre|cinema|courthouse|post_office|social_facility|bus_station|marketplace|place_of_worship|pharmacy)$"](area.mun);
  nwr["office"="government"](area.mun);
  nwr["healthcare"="centre"](area.mun);
  nwr["emergency"="ambulance_station"](area.mun);
  nwr["leisure"~"^(sports_centre|stadium|swimming_pool|park)$"]["name"](area.mun);
  nwr["tourism"~"^(museum|attraction)$"]["name"](area.mun);
  nwr["historic"]["name"](area.mun);
  nwr["railway"="station"](area.mun);
  nwr["place"~"^(town|city|village|hamlet|suburb|neighbourhood|quarter|isolated_dwelling)$"](area.mun);
  nwr["landuse"="industrial"](area.mun);
);
out body;
>;
out skel qt;
