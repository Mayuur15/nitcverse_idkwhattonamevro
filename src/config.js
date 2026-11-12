// ------------------------------------------------------------------
//  Everything you are likely to tweak lives here.
//  URL switches:  ?hour=22   start at 10pm      ?low   lighter graphics
//                 ?noimg     no satellite imagery
// ------------------------------------------------------------------
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const low = q.has('low');

export const CONFIG = {
  spawnName: 'main gate',          // a named point in the geojson to start next to
  startHour: q.has('hour') ? parseFloat(q.get('hour')) : 10.5,
  dayLengthMinutes: 12,            // real minutes for a full 24h cycle (0 = frozen time)

  imagery: {
    enabled: !q.has('noimg'),
    // Esri World Imagery (free for personal / non-commercial use, attribution required).
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    baseZoom: 16,                  // whole-campus layer
    nearZoom: 18,                  // sharp layer around you (19 is sharper if coverage exists)
    nearRadius: low ? 1 : 2,       // tiles around you at nearZoom (2 -> 5x5)
  },

  trees: { enabled: true, stepPx: low ? 10 : 7, maxPerTile: low ? 250 : 650 },
  pedestrians: low ? 20 : 50,
  cars: low ? 4 : 10,
  shadows: !low,

  musicUrl: null,                  // e.g. '/lofi.mp3' to loop background music
};

// Fallback colours for buildings that have no style below.
export const PALETTE = ['#e8dcc4', '#d9c7a3', '#efe6d8', '#cfc2a6', '#d8b9a0', '#c9d2d6', '#e3d3b8'];

// ------------------------------------------------------------------
//  Per-building overrides, keyed by OSM id (string) or lowercase name.
//  Options: color, levels, height (metres), roof ('#hex')
//  The geojson only has footprints, so colours/heights not in the data are guesses.
//  Fix them with what you know of the campus, e.g.:
//    '1352094016': { color: '#c98f6a', levels: 4 },    // Main Building
//    'central library': { color: '#f1ede4' },
// ------------------------------------------------------------------
export const BUILDING_STYLE = {
  '1352102017': { color: '#a3a39d', levels: 7 },        // New Academic Building (under construction)
};
