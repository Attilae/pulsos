// Trivia shown on the AI Composer's "arranging…" overlay while the model
// thinks. Pools are deliberately large: a generation takes ~10–30 s and the
// overlay rotates every few seconds, so a short list means every wait shows the
// same handful of facts. Order is shuffled per run (see shuffledFactsForCity).
export const CITY_FACTS = Object.freeze({
  budapest: [
    'Budapest\'s M1 opened in 1896 as continental Europe\'s first electric underground railway.',
    'The Millennium Underground was built in just 22 months beneath Andrássy Avenue.',
    'Emperor Franz Joseph rode the new underground in a specially built royal carriage in May 1896.',
    'The M1 line is inscribed on the UNESCO World Heritage list along with Andrássy Avenue.',
    'The 4–6 tram on the Grand Boulevard runs around the clock and is one of the busiest tram lines in the world.',
    'The Combino Supra trams on lines 4 and 6 are among the longest trams anywhere, at roughly 54 metres.',
    'Budapest\'s first trolleybus line was numbered 70 — chosen in 1949 to mark Stalin\'s seventieth birthday.',
    'The cogwheel railway climbing into the Buda Hills is part of the ordinary city network.',
    'HÉV suburban railway lines carry an H prefix and run well past the city limits.',
    'M2 was the first line to cross beneath the Danube when it opened in 1970.',
    'Budapest\'s night bus routes are numbered in the 900s.',
    'The Buda Hills Children\'s Railway is staffed largely by children aged 10 to 14, supervised by adults.',
  ],
  helsinki: [
    'One HSL ticket can connect buses, trams, Metro trains, commuter trains, and ferries.',
    'HSL stop numbers begin with a letter showing their municipality, such as H for Helsinki and E for Espoo.',
    'Helsinki\'s orbital Light Rail 15 began carrying passengers in October 2023.',
    'Helsinki runs one of the world\'s northernmost metro systems.',
    'The Länsimetro extension carried the Metro west into Espoo in 2017, and on to Kivenlahti in 2022.',
    'Electric trams have run on Helsinki\'s streets since 1900.',
    'The Suomenlinna ferry to the UNESCO sea fortress runs on an ordinary HSL ticket.',
    'HSL fare zones are simply lettered A to D, radiating outward from the centre.',
    'The Ring Rail Line loops commuter trains through the airport and back into the city.',
    'For years the Metro was a single line that split into two branches out east.',
    'HSL publishes its timetables and real-time feeds openly — which is why Helsinki can be played here at all.',
    'Helsinki\'s tram network has been expanding again after decades of contraction.',
  ],
  berlin: [
    'Berlin\'s first electric U-Bahn opened to passengers in February 1902.',
    'Berlin runs two U-Bahn loading profiles: the smaller U1–U4 trains and wider U5–U9 trains.',
    'East Berlin\'s BVB and West Berlin\'s BVG reunited as one operator in 1992.',
    'During the division, West Berlin trains rolled slowly through sealed "ghost stations" in the East without stopping.',
    'The U55 ran for a decade as a three-station stub before finally joining the U5 in 2020.',
    'Almost all of Berlin\'s tram network lies in the former East of the city.',
    'The Ringbahn is nicknamed the Hundekopf — a dog\'s head — for its shape on the map.',
    'BVG runs ferries on Berlin\'s lakes as part of the normal network, and one of them is still rowed by hand.',
    'VBB fare zone C reaches all the way out to Potsdam and BER airport.',
    'U-Bahn lines run right through the night on weekends; night buses take an N prefix.',
    'The U-Bahn network covers roughly 155 kilometres and 175 stations.',
    'The S-Bahn draws power from a side-contact third rail, unlike the overhead wires of mainline trains.',
  ],
  prague: [
    'Prague dates the beginning of its public transport story to a horse-drawn tram opened in 1875.',
    'An underground railway was proposed for Prague in 1898—and rejected as unnecessary.',
    'Prague\'s first Metro service opened on Line C in May 1974.',
    'Náměstí Míru is one of the deepest metro stations in Europe, reached by the longest escalator in the EU.',
    'Prague\'s Metro was built to double as a shelter — blast doors are still fitted in the tunnels.',
    'The 2002 floods filled much of the Metro with water and it took months to fully reopen.',
    'Historic tram line 23 runs vintage cars on an ordinary timetable through the city centre.',
    'Every Prague night tram passes through Lazarská, so any two night lines can be connected there.',
    'The Petřín funicular is part of the network and accepts a normal transit ticket.',
    'Prague Integrated Transport reaches far out into Central Bohemia, well past the city boundary.',
    'A fourth Metro line, D, has been under construction since 2022.',
    'Early Line C trains were Soviet-built Ečs cars, delivered when the system opened.',
  ],
  newyork: [
    'New York City Transit maintains 472 subway stations across the five boroughs.',
    'Full overnight subway service returned in May 2021, restoring the city\'s 24/7 rhythm.',
    'The subway network contains roughly 640 miles of track.',
    'New York is one of very few cities on Earth whose metro runs 24 hours a day.',
    'The first underground line opened in 1904, though elevated railways had already run for decades.',
    'Three formerly competing systems — the IRT, BMT and IND — still explain the split between numbered and lettered routes.',
    'Numbered IRT trains run on narrower cars than the lettered lines, so the fleets can\'t be swapped.',
    'Express and local tracks running side by side let trains overtake each other — a rarity worldwide.',
    'The G is the only full-time route that never touches Manhattan.',
    'The Second Avenue Subway finally opened in 2017, nearly a century after it was first proposed.',
    'The colourful mosaics and tablets in older stations were designed to make stops identifiable at a glance.',
    'The Staten Island Ferry carries millions of passengers a year and is free to ride.',
  ],
  zurich: [
    'ZVV launched in 1990 as Switzerland\'s first integrated transport network.',
    'ZVV coordinates more than 30 transport companies under one fare network.',
    'Passenger numbers on Zürich\'s S-Bahn have more than tripled since its 1990 launch.',
    'Zürich has no metro: voters rejected underground schemes twice, in 1962 and again in 1973.',
    'Instead of a metro the city invested in dense tram lines and a regional S-Bahn.',
    'Trolleybuses still run on overhead wires through the middle of the city.',
    'The S-Bahn\'s core threads through the Museumsstrasse tunnel beneath the main station.',
    'Zürich Hauptbahnhof is one of the busiest railway stations in Europe by train movements.',
    'Boats on the Zürichsee are part of the same fare network as the trams.',
    'The Polybahn funicular up to ETH is covered by an ordinary ZVV ticket.',
    'Timetables are built on the Taktfahrplan principle — the same departure minutes, hour after hour.',
    'Switzerland has among the highest rail use per person in the world, and Zürich sits at the centre of it.',
  ],
  warsaw: [
    'Construction of Warsaw\'s first Metro line began in 1985.',
    'Warsaw Metro opened in 1995 with an 11-kilometre line and 11 stations.',
    'By its 30th birthday, Warsaw Metro had grown to 39 stations and almost 40 kilometres.',
    'Warsaw planned a metro in the 1920s and started digging again in the 1950s; both attempts were abandoned.',
    'Fragments of the abandoned 1950s deep tunnel still exist beneath the city.',
    'Line M2 crosses under the Vistula to reach the Praga side of the river.',
    'Warsaw runs one of the largest tram networks in Europe.',
    'Bus numbers encode the service: 400s and 500s skip stops, 700s leave the city, and N-lines run at night.',
    'SKM commuter trains share the same ZTM tickets as the buses, trams and Metro.',
    'Each M2 station was given its own colour scheme and architectural treatment.',
    'Free seasonal ferries carry passengers across the Vistula in the summer months.',
    'Warsaw\'s transit network was rebuilt almost from nothing after the city\'s destruction in 1944.',
  ],
})

export function factsForCity(cityId) {
  return CITY_FACTS[cityId] ?? CITY_FACTS.budapest
}

/**
 * A freshly shuffled copy of a city's facts, so consecutive generations don't
 * replay the same order. `avoid` is the fact shown last time: if the shuffle
 * happens to lead with it, it's rotated to the back so the user never sees the
 * same line twice in a row across two waits.
 */
export function shuffledFactsForCity(cityId, avoid = null) {
  const out = factsForCity(cityId).slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (out.length > 1 && avoid && out[0] === avoid) out.push(out.shift())
  return out
}
