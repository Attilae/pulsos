// Mocked transit lines with realistic Budapest stop lat/lng

export const LINES = [
  {
    id: 'M2', name: 'Metro M2', type: 'metro', color: '#E2001A', bpm: 72,
    stops: [
      { id: 'm2_oers',  name: 'Örs vezér tere',   lat: 47.5072, lng: 19.1370 },
      { id: 'm2_pest',  name: 'Pesti út',          lat: 47.5020, lng: 19.1180 },
      { id: 'm2_kesp',  name: 'Kerepesi út',       lat: 47.4980, lng: 19.1040 },
      { id: 'm2_kelv',  name: 'Keleti pu.',        lat: 47.5000, lng: 19.0832 },
      { id: 'm2_blah',  name: 'Blaha Lujza tér',  lat: 47.4965, lng: 19.0710 },
      { id: 'm2_astd',  name: 'Astoria',           lat: 47.4950, lng: 19.0620 },
      { id: 'm2_deak',  name: 'Deák Ferenc tér',  lat: 47.4984, lng: 19.0510 },
      { id: 'm2_koss',  name: 'Kossuth tér',      lat: 47.5056, lng: 19.0456 },
      { id: 'm2_batth', name: 'Batthyány tér',    lat: 47.5072, lng: 19.0357 },
      { id: 'm2_szell', name: 'Széll Kálmán tér', lat: 47.5100, lng: 18.9991 },
      { id: 'm2_moszk', name: 'Déli pu.',         lat: 47.4955, lng: 18.9871 },
    ],
  },
  {
    id: 'M3', name: 'Metro M3', type: 'metro', color: '#0066CC', bpm: 68,
    stops: [
      { id: 'm3_ujp',     name: 'Újpest-Városkapu',  lat: 47.5790, lng: 19.0851 },
      { id: 'm3_ujpk',    name: 'Újpest-Központ',    lat: 47.5690, lng: 19.0810 },
      { id: 'm3_gyongy',  name: 'Gyöngyösi u.',      lat: 47.5600, lng: 19.0780 },
      { id: 'm3_forgach', name: 'Forgách u.',        lat: 47.5510, lng: 19.0750 },
      { id: 'm3_arpad',   name: 'Árpád híd',        lat: 47.5420, lng: 19.0547 },
      { id: 'm3_dozzsa',  name: 'Dózsa György út',  lat: 47.5290, lng: 19.0700 },
      { id: 'm3_lehel',   name: 'Lehel tér',        lat: 47.5200, lng: 19.0680 },
      { id: 'm3_nyugati', name: 'Nyugati pu.',      lat: 47.5110, lng: 19.0549 },
      { id: 'm3_arany',   name: 'Arany J. u.',      lat: 47.5045, lng: 19.0527 },
      { id: 'm3_deak',    name: 'Deák Ferenc tér',  lat: 47.4984, lng: 19.0510 },
      { id: 'm3_kalvin',  name: 'Kálvin tér',       lat: 47.4900, lng: 19.0619 },
      { id: 'm3_corvin',  name: 'Corvin-negyed',    lat: 47.4840, lng: 19.0680 },
      { id: 'm3_klinik',  name: 'Klinikák',         lat: 47.4790, lng: 19.0750 },
      { id: 'm3_nharom',  name: 'Nagyvárad tér',    lat: 47.4730, lng: 19.0810 },
      { id: 'm3_ecseri',  name: 'Ecseri út',        lat: 47.4610, lng: 19.0960 },
      { id: 'm3_pest_d',  name: 'Pöttyös u.',       lat: 47.4540, lng: 19.1110 },
      { id: 'm3_hatarut', name: 'Határ út',         lat: 47.4460, lng: 19.1260 },
      { id: 'm3_kobanya', name: 'Kőbánya-Kispest',  lat: 47.4380, lng: 19.1495 },
    ],
  },
  {
    id: 'T4_6', name: 'Tram 4-6', type: 'tram', color: '#FFD700', bpm: 120,
    stops: [
      { id: 't46_ujbuda',    name: 'Újbuda-Kzp',       lat: 47.4640, lng: 18.9987 },
      { id: 't46_mori',      name: 'Móricz Zs. körtér', lat: 47.4720, lng: 19.0003 },
      { id: 't46_bercs',     name: 'Bercsényi u.',      lat: 47.4760, lng: 19.0060 },
      { id: 't46_pet',       name: 'Petőfi híd',        lat: 47.4800, lng: 19.0100 },
      { id: 't46_fovam',     name: 'Fővám tér',         lat: 47.4865, lng: 19.0520 },
      { id: 't46_kalvin',    name: 'Kálvin tér',        lat: 47.4900, lng: 19.0619 },
      { id: 't46_astoria',   name: 'Astoria',           lat: 47.4950, lng: 19.0620 },
      { id: 't46_blaha',     name: 'Blaha Lujza',       lat: 47.4965, lng: 19.0710 },
      { id: 't46_keleti',    name: 'Keleti pu.',        lat: 47.5000, lng: 19.0832 },
      { id: 't46_baross',    name: 'Baross tér',        lat: 47.5020, lng: 19.0870 },
      { id: 't46_keleti2',   name: 'Keleti 2',          lat: 47.5035, lng: 19.0890 },
      { id: 't46_gaborjani', name: 'Gábor Áron u.',     lat: 47.5060, lng: 19.0370 },
      { id: 't46_mechwart',  name: 'Mechwart liget',    lat: 47.5090, lng: 19.0280 },
      { id: 't46_szell',     name: 'Széll Kálmán tér',  lat: 47.5100, lng: 18.9991 },
      { id: 't46_szena',     name: 'Széna tér',         lat: 47.5115, lng: 18.9960 },
    ],
  },
  {
    id: 'HEV_H5', name: 'HÉV H5', type: 'hev', color: '#009640', bpm: 40,
    stops: [
      { id: 'h5_batth',       name: 'Batthyány tér',   lat: 47.5072, lng: 19.0357 },
      { id: 'h5_margit',      name: 'Margit híd',      lat: 47.5150, lng: 19.0332 },
      { id: 'h5_tima',        name: 'Timár u.',         lat: 47.5220, lng: 19.0340 },
      { id: 'h5_filatorigat', name: 'Filatorigát',     lat: 47.5300, lng: 19.0362 },
      { id: 'h5_aquinc',      name: 'Aquincum',        lat: 47.5390, lng: 19.0419 },
      { id: 'h5_roman',       name: 'Rómaifürdő',      lat: 47.5530, lng: 19.0470 },
      { id: 'h5_csillaghegy', name: 'Csillaghegy',     lat: 47.5640, lng: 19.0480 },
      { id: 'h5_bekasm',      name: 'Békásmegyer',     lat: 47.5730, lng: 19.0490 },
      { id: 'h5_kalma',       name: 'Kalmár u.',        lat: 47.5810, lng: 19.0510 },
      { id: 'h5_szenth',      name: 'Szentendre',      lat: 47.6600, lng: 19.0740 },
    ],
  },
]

// Legacy pentatonic latToNote kept for App.jsx mock lane display
const PENTATONIC = ['C', 'D', 'E', 'G', 'A']
export function latToNote(lat) {
  const MIN_LAT = 47.35, MAX_LAT = 47.70
  const OCTAVES = [3, 4, 5]
  const total = PENTATONIC.length * OCTAVES.length
  const t     = Math.max(0, Math.min(1, (lat - MIN_LAT) / (MAX_LAT - MIN_LAT)))
  const step  = Math.round(t * (total - 1))
  return `${PENTATONIC[step % PENTATONIC.length]}${OCTAVES[Math.floor(step / PENTATONIC.length)]}`
}
