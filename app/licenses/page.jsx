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

      <LegalSection number={2} title="Impulse responses">
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

      <LegalSection number={3} title="Maps and transit data">
        <p>
          Map tiles are provided by CARTO using OpenStreetMap data. © OpenStreetMap contributors;
          map data is available under the{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Open Data Commons Open Database License</a>.
          CARTO’s applicable attribution and terms also apply.
        </p>
        <p>
          Route, stop, and realtime data is supplied by the transport agencies selected in Leið,
          including BKK, HSL, VBB, PID, MTA, ZVV, and ZTM or their designated open-data services.
          The active map displays the relevant agency attribution. Agency names and marks belong
          to their respective owners; their appearance does not imply endorsement of Leið.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Open-source software">
        <p>
          Leið uses open-source packages including Next.js, React, Tone.js, Leaflet, Better Auth,
          Drizzle ORM, and their dependencies. Each package remains licensed by its authors under
          the licence distributed with that package. Source-package notices in the deployed
          dependency tree control if this summary differs from a package’s own licence.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Corrections">
        <p>
          If a credit is incomplete or you believe material is being used under the wrong terms,
          please email <a href="mailto:hello@deettalabs.com">hello@deettalabs.com</a> with enough
          detail to identify it. We will investigate and correct or remove it where appropriate.
        </p>
      </LegalSection>
    </LegalShell>
  )
}

