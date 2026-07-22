export const CITY_FACTS = Object.freeze({
  budapest: [
    'Budapest\'s M1 opened in 1896 as continental Europe\'s first electric underground railway.',
    'The Millennium Underground was built in just 22 months beneath Andrássy Avenue.',
    'Emperor Franz Joseph rode the new underground in a specially built royal carriage in May 1896.',
  ],
  helsinki: [
    'One HSL ticket can connect buses, trams, Metro trains, commuter trains, and ferries.',
    'HSL stop numbers begin with a letter showing their municipality, such as H for Helsinki and E for Espoo.',
    'Helsinki\'s orbital Light Rail 15 began carrying passengers in October 2023.',
  ],
  berlin: [
    'Berlin\'s first electric U-Bahn opened to passengers in February 1902.',
    'Berlin runs two U-Bahn loading profiles: the smaller U1–U4 trains and wider U5–U9 trains.',
    'East Berlin\'s BVB and West Berlin\'s BVG reunited as one operator in 1992.',
  ],
  prague: [
    'Prague dates the beginning of its public transport story to a horse-drawn tram opened in 1875.',
    'An underground railway was proposed for Prague in 1898—and rejected as unnecessary.',
    'Prague\'s first Metro service opened on Line C in May 1974.',
  ],
  newyork: [
    'New York City Transit maintains 472 subway stations across the five boroughs.',
    'Full overnight subway service returned in May 2021, restoring the city\'s 24/7 rhythm.',
    'The subway network contains roughly 640 miles of track.',
  ],
  zurich: [
    'ZVV launched in 1990 as Switzerland\'s first integrated transport network.',
    'ZVV coordinates more than 30 transport companies under one fare network.',
    'Passenger numbers on Zürich\'s S-Bahn have more than tripled since its 1990 launch.',
  ],
  warsaw: [
    'Construction of Warsaw\'s first Metro line began in 1985.',
    'Warsaw Metro opened in 1995 with an 11-kilometre line and 11 stations.',
    'By its 30th birthday, Warsaw Metro had grown to 39 stations and almost 40 kilometres.',
  ],
})

export function factsForCity(cityId) {
  return CITY_FACTS[cityId] ?? CITY_FACTS.budapest
}
