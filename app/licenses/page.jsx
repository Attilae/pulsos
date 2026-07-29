import { DataTable, LegalSection, LegalShell } from '@/components/legal/LegalShell.jsx'

export const metadata = {
  title: 'Licences & Credits',
  description: 'Third-party audio, map, transit-data, and software credits for Leið.',
  alternates: { canonical: '/licenses' },
}

const impulseResponses = [
  ['tunnel.wav', 'Innocent Railway Tunnel, Edinburgh', 'Andrew Chadwick; Simon Shelley'],
  ['cave.wav', 'Creswell Crags, Derbyshire', 'OpenAIR / openairlib.net'],
  ['stairwell.wav', 'Stairway, University of York', 'Audiolab, University of York; Simon Shelley'],
  ['cathedral.wav', 'Lady Chapel, St Albans Cathedral', 'Audiolab, University of York; Marcin Gorzel; Gavin Kearney; Aglaia Foteinou; Sorrel Hoare; Simon Shelley'],
  ['hall.wav', 'Central Hall, University of York', 'Alexander Vilkaitis; Ilias Antonopoulos; Joska De Langen; Xuan Liu'],
  ['warehouse.wav', "Terry's Factory Warehouse, York", 'Audiolab, University of York; Dr. Damian T. Murphy'],
]

const melodicSamples = [
  [
    'Piano (Salamander)',
    'Salamander Grand Piano V3 by Alexander Holm',
    'CC BY 3.0',
    'https://github.com/sfzinstruments/SalamanderGrandPiano',
  ],
  [
    'Casio',
    'Casio sample set by Yotam Mann (2015)',
    'CC BY-NC-SA 4.0',
    'https://github.com/Tonejs/audio/tree/master/casio',
  ],
  [
    'tonejs-instruments collection',
    'Electric bass; bassoon; cello; clarinet; contrabass; flute; French horn; acoustic, electric, and nylon guitars; harmonium; harp; organ; piano; saxophone; trombone; trumpet; tuba; violin; and xylophone',
    'CC BY 3.0',
    'https://github.com/nbrosowsky/tonejs-instruments',
  ],
]

const transitSources = [
  ['Budapest', 'BKK', 'BKK open-data terms', 'https://opendata.bkk.hu/'],
  ['Helsinki', 'Helsingin seudun liikenne (HSL)', 'CC BY 4.0', 'https://www.hsl.fi/en/hsl/open-data'],
  ['Berlin', 'Verkehrsverbund Berlin-Brandenburg (VBB)', 'CC BY 4.0', 'https://www.vbb.de/vbb-services/api-open-data/'],
  ['Prague', 'Pražská integrovaná doprava (PID)', 'CC BY 4.0', 'https://pid.cz/en/opendata/'],
  ['New York', 'Metropolitan Transportation Authority (MTA)', 'MTA developer/open-data terms', 'https://www.mta.info/developers'],
  ['Zürich', 'ZVV / VBZ via the City of Zürich open-data portal', 'CC0', 'https://data.stadt-zuerich.ch/dataset/vbz_fahrplandaten_gtfs'],
  ['Warsaw', 'ZTM Warszawa data packaged by Mikołaj Kuranowski', 'Source and agency terms', 'https://mkuran.pl/gtfs/'],
]

export default function LicensesPage() {
  return (
    <LegalShell
      current="/licenses"
      kicker="Licences & credits / route 03"
      title="Sources behind the sound."
      summary="Leið is built with public data, open software, and generously licensed audio. These are the credits that travel with it."
    >
      <LegalSection number={1} title="Drum samples">
        <p>
          The bundled TR-808 drum samples come from Michael Fischer’s <em>Roland TR-808 Rhythm
          Composer Sound Sample Set 1.0.0</em> (1994), released into the public domain and
          distributed through the{' '}
          <a href="https://github.com/tidalcycles/sounds-tr808-fischer" target="_blank" rel="noreferrer">
            tidalcycles/sounds-tr808-fischer
          </a>{' '}and{' '}
          <a href="https://github.com/tidalcycles/Dirt-Samples" target="_blank" rel="noreferrer">
            Dirt-Samples
          </a>{' '}repositories under{' '}
          <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">
            CC0 1.0
          </a>.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Melodic samples">
        <p>
          Sample-backed instruments selected in the DAW stream their audio files from the Tone.js
          and tonejs-instruments projects on GitHub Pages. The following credits and licence terms
          apply to those sample files:
        </p>
        <DataTable
          headers={['Preset', 'Source / credit', 'Licence', 'Project']}
          rows={melodicSamples.map(([preset, credit, licence, url]) => [
            preset,
            credit,
            <a key={licence} href={
              licence === 'CC BY-NC-SA 4.0'
                ? 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
                : 'https://creativecommons.org/licenses/by/3.0/'
            } target="_blank" rel="noreferrer">{licence}</a>,
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {new URL(url).pathname.replace(/\/$/, '')}
            </a>,
          ])}
        />
        <p>
          These licences apply to the third-party samples themselves and do not imply endorsement
          of Leið by their authors or source projects. The tonejs-instruments project notes that
          its edited samples originate from multiple public-domain sources; its project-level
          sample licence and source notices govern.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Impulse responses">
        <p>
          The bundled acoustic impulse responses are derived from the{' '}
          <a href="https://www.openair.hosted.york.ac.uk/" target="_blank" rel="noreferrer">
            Open Acoustic Impulse Response Library
          </a>, University of York, and are licensed under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            Creative Commons Attribution 4.0 International
          </a>.
        </p>
        <DataTable headers={['File', 'Space', 'Credits']} rows={impulseResponses} />
      </LegalSection>

      <LegalSection number={4} title="Maps and transit data">
        <p>
          Map tiles are provided by CARTO using OpenStreetMap data. © OpenStreetMap contributors;
          map data is available under the{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Open Data Commons Open Database License</a>.
          CARTO’s applicable attribution and terms also apply.
        </p>
        <p>
          Route, stop, and realtime data is supplied by the following agencies or their designated
          open-data services. Where a standard open licence is not stated by the city descriptor,
          the source’s published terms apply.
        </p>
        <DataTable
          headers={['City', 'Agency / source', 'Licence or terms', 'Dataset information']}
          rows={transitSources.map(([city, source, licence, url]) => [
            city,
            source,
            licence,
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {new URL(url).hostname}
            </a>,
          ])}
        />
        <p>
          The active map also displays the relevant agency attribution. Agency names and marks
          belong to their respective owners; their appearance does not imply endorsement of Leið.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Open-source software">
        <p>
          Leið uses open-source packages including Next.js, React, Tone.js, Leaflet, Better Auth,
          Drizzle ORM, and their dependencies. Each package remains licensed by its authors under
          the licence distributed with that package. Source-package notices in the deployed
          dependency tree control if this summary differs from a package’s own licence.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Corrections">
        <p>
          If a credit is incomplete or you believe material is being used under the wrong terms,
          please email <a href="mailto:hello@deettalabs.com">hello@deettalabs.com</a> with enough
          detail to identify it. We will investigate and correct or remove it where appropriate.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
