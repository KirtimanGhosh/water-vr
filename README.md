# Water VR — the phases of water

A narrated 360° tour of the phases of water for a phone or a Cardboard-style phone VR headset: from a beaker of water down to moving molecules, through liquid, supercooled water, ices Ih, III, VI and VII, melting, boiling, steam, sublimation and supercritical water.
Narration and subtitles in English, বাংলা, हिन्दी and ଓଡ଼ିଆ.

Live app: https://kirtimanghosh.github.io/water-vr/

## How to use
- **▶ Tour** starts the 16-chapter narrated tour (⏮ ❚❚ ⏭ to move between chapters). Choose the language from the menu.
- **👓 Headset**: split-screen stereo; turn your head to look around. Tap once to show buttons, hold to fly forward.
- **⚙ → Free mode**: pick any temperature and pressure; the IAPWS phase diagram decides which phase is simulated.
- **🎤** voice commands (need internet): next, previous, pause, resume, repeat, start tour, end tour, zoom in, zoom out, dive in, back to beaker, forward, stop, faster, slower, diagram, recentre.
- **∑** shows every equation used and a table comparing simulated and measured densities.

## Physics
- Molecules: rigid TIP4P/Ice water model (Abascal et al., J. Chem. Phys. 122, 234511 (2005)), melting point 272.2 K.
- Forces: damped-shifted-force electrostatics (Fennell & Gezelter 2006), Lennard-Jones with long-range corrections.
- Motion: velocity Verlet + SHAKE/RATTLE, 2 fs steps; Bussi thermostat; stochastic cell-rescaling barostat (Bernetti & Bussi 2020).
- Ice crystals: GenIce (proton-disordered structures that obey the ice rules), then equilibrated at their temperature and pressure.
- Phase diagram: IAPWS R14-08(2011) melting and sublimation curves and IAPWS SR1-86 vapour-pressure equation, verified against the IAPWS check values.
- Melting (330 K) and evaporation (550 K) are recorded simulations played as time-lapse; every other scene runs live on the phone.

## Files
`index.html`, `app.js` (scenes, stereo, tour, narration), `md2.js` (simulation), `md-worker.js`, `phase-eq.js` (IAPWS equations), `narration.js` (four languages),
`data/` (equilibrated states and two recordings), `lib/three.min.js`, `sw.js` (offline), `manifest.webmanifest`, icons.
