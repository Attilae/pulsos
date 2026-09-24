import { notFound } from 'next/navigation'
import { DataTable, LegalSection } from '@/components/legal/LegalShell.jsx'
import { GuideShell, MCP_GUIDES_ENABLED, MCP_URL } from '@/components/guides/GuideShell.jsx'

export const metadata = {
  title: 'Connect an AI client',
  description: 'Connect Claude or another MCP client to Leið and compose songs from a city’s transit lines in conversation.',
  alternates: { canonical: '/guides/mcp' },
}

const TOOLS = [
  ['list_cities', 'Lists the cities you can compose in.', 'Read'],
  ['list_songs / get_song', 'Lists your saved songs and reads one of them, with a summary of what its lanes play.', 'Read'],
  ['get_composer_guide', 'Returns the musical guidance, instruments, effects, scales and ranges a plan may use, your lane limit, and the genre recipes. Pass a genre to get that recipe.', 'Read'],
  ['list_routes', 'Finds a city’s lines by type or name. Each line becomes a track.', 'Read'],
  ['preview_song_plan', 'Checks a plan and reports anything invalid. Saves nothing.', 'Read'],
  ['create_song_from_plan', 'Saves a plan as a new song in your library. Every lane starts from clean defaults.', 'Write'],
  ['apply_plan_to_song', 'Applies a plan to one of your saved songs.', 'Write'],
  ['set_song_tempo', 'Changes a saved song’s BPM.', 'Write'],
]

export default function McpGuidePage() {
  if (!MCP_GUIDES_ENABLED) notFound()

  return (
    <GuideShell
      current="/guides/mcp"
      kicker="Leið Pro · AI"
      title="Connect an AI client"
      summary="Describe a loop in words and let your AI assistant build it from real transit lines. Leið speaks MCP, the open protocol AI clients use to call tools, so Claude or another client can read and write your saved songs."
      meta={[
        { label: 'Plan', value: 'Leið Pro' },
        { label: 'Protocol', value: 'MCP (Streamable HTTP)' },
        { label: 'Sign-in', value: 'OAuth, your Leið account' },
      ]}
    >
      <LegalSection number={1} title="What it is">
        <p>
          Leið runs an MCP server, a small set of tools an AI client can call on your behalf.
          Once it is connected, you can ask for music in plain language, for example
          “a slow dub loop in Budapest with a kick-ducked bass”. The assistant looks up the
          city’s lines, writes a loop plan, has Leið check it, and saves it as a song in your
          library. You then open the song in Leið and press Play.
        </p>
        <p>
          Your AI client does the thinking, so composing this way doesn’t use the in-app AI
          Composer’s monthly allowance.
        </p>
      </LegalSection>

      <LegalSection number={2} title="What you need">
        <ul>
          <li>A <strong>Leið Pro</strong> account. Pro is checked on every request, so if the subscription ends, access stops straight away.</li>
          <li>
            An AI client that supports <strong>remote MCP servers with OAuth</strong>, such as
            Claude (web, desktop or Claude Code) with a custom connector, or any other
            standards-compliant MCP client.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={3} title="Connect it">
        <ol>
          <li>
            Copy the server URL: <code>{MCP_URL}</code>. It is also shown in Leið under the
            <strong> ⋯</strong> menu → <strong>Connect an AI client</strong>.
          </li>
          <li>
            In Claude, open <strong>Settings → Connectors → Add custom connector</strong>, name it
            “Leið”, and paste the URL. In other clients, add a remote (HTTP) MCP server with the
            same URL.
          </li>
          <li>Choose <strong>Connect</strong>. A Leið window opens. Sign in with your Leið account.</li>
          <li>Review what the client is asking for and approve it. The client is now connected.</li>
          <li>
            Optional: install the <a href="/guides/composer-skill">Leið composer skill</a>. It
            teaches Claude the workflow and gives it genre recipes, which makes the results noticeably better.
          </li>
        </ol>
      </LegalSection>

      <LegalSection number={4} title="What it can do">
        <DataTable headers={['Tool', 'What it does', 'Access']} rows={TOOLS.map(([tool, what, access]) => [<code key={tool}>{tool}</code>, what, access])} />
        <p>
          Write tools only change <strong>your own saved songs</strong>. An edit sends along the
          version it read, so if you changed the same song in the browser in the meantime, the
          edit is refused instead of overwriting your work.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Try asking">
        <blockquote>Make a 76 BPM dub loop in Budapest. Use a metro line for a deep bass that ducks under the kick, and a tram for a delayed skank.</blockquote>
        <blockquote>Compose something ambient from Helsinki’s buses: sparse bells, two slow pads, lots of reverb, no drums.</blockquote>
        <blockquote>Open my song “Night Tram” and make it sparser. Drop the hats, slow the lead down, and set it to 90 BPM.</blockquote>
        <p>
          The assistant replies with a link that opens the song in Leið. If that song is already
          open in a tab, reload it to hear the changes.
        </p>
      </LegalSection>

      <LegalSection number={6} title="What it cannot do">
        <ul>
          <li>It can’t play, record or export audio. Listening happens in Leið.</li>
          <li>It can’t control a Leið tab you already have open. It changes saved songs, and you open them.</li>
          <li>
            It doesn’t cover the manual editing work: per-stop notes, the 8-band EQ, automation lanes and
            duplicate or chord lanes stay in the DAW.
          </li>
          <li>A song belongs to one city, and a plan can use up to your plan’s active-lane limit.</li>
        </ul>
      </LegalSection>

      <LegalSection number={7} title="Privacy & disconnecting">
        <p>
          A connected client can read, create and change your saved songs through the tools
          above. It can’t see your password, billing details or other account data. Your
          conversation never reaches Leið. Only the loop plans the client writes do, and your
          prompts stay with your AI client under its own terms.
        </p>
        <p>
          To disconnect, open <strong>⋯ → Connect an AI client</strong> in Leið and choose
          <strong> Disconnect</strong> next to the client. Its access is revoked at once, even if it
          still holds an unexpired token. See the <a href="/privacy">privacy notice</a> for the rest.
        </p>
      </LegalSection>
    </GuideShell>
  )
}
