# NITC Campus 3D

Walkable 3D NIT Calicut, built from `src/nitc.geojson` (OpenStreetMap) + live satellite imagery.

## Run
**Quickest:** double-click `nitc-3d.html` (needs internet for satellite tiles + sound works after you click Start).

**In VS Code:**
    npm install
    npm run dev          # open the printed localhost link
    npm run build        # makes one self-contained dist/index.html
    npm run smoke        # headless logic test

## Controls
WASD/arrows move · Shift run · Space jump · drag mouse look · scroll zoom
T satellite/flat-map · N jump time of day · M mute

URL options: `?hour=22` start at night · `?low` lighter graphics · `?noimg` no satellite

## What's in it
- Buildings extruded from footprints with procedural windows (lit at night), roof tanks, labels
- Satellite imagery streamed from Esri (sharp tiles near you); trees placed where the imagery is dark green
- Day/night cycle with sky, sun, moon, stars, street lamps (447), glowing windows
- 50 students walking the real path network, 10 cars driving on roads (keeping left)
- Synth sound: wind, birds by day, crickets at night, footsteps, crowd murmur, engines
- Minimap, gates, benches, water, pitches, mobile tower with blinking light

## Make it look more like the real campus
Edit `src/config.js` → `BUILDING_STYLE` (colour, floors, height per building, by OSM id or name).
Walls: the data has no wall/fence lines; if you add `barrier=wall|fence|hedge` lines to the
geojson they appear automatically and block you.

## Notes / limits
- Ground is flat (no terrain heights yet). Next step: elevation tiles.
- Imagery © Esri and partners, free for personal/non-commercial use; keep the attribution.
- Building colours/heights not in the OSM data are guesses.
