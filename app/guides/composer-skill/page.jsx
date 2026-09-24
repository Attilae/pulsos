import { notFound } from 'next/navigation'
import { LegalSection } from '@/components/legal/LegalShell.jsx'
import { GuideShell, MCP_GUIDES_ENABLED } from '@/components/guides/GuideShell.jsx'

export const metadata = {
  title: 'Leið composer skill',
  description: 'An Agent Skill that teaches Claude how to compose Leið loops: the workflow, genre recipes and how to fix what goes wrong.',
  alternates: { canonical: '/guides/composer-skill' },
}

const SKILL_ZIP = '/skills/leid-composer.zip'

export default function ComposerSkillGuidePage() {
  if (!MCP_GUIDES_ENABLED) notFound()

  return (
    <GuideShell
      current="/guides/composer-skill"
      kicker="Leið Pro · AI"
      title="Composer skill"
      summary="A free add-on for Claude that turns a connected Leið into a better composing partner. It teaches Claude how Leið’s tools fit together, how transit lines behave as instruments, and a handful of genre recipes to start from."
      meta={[
        { label: 'Works with', value: 'Claude (Agent Skills)' },
        { label: 'Requires', value: <a href="/guides/mcp">Leið connector</a> },
        { label: 'Download', value: <a href={SKILL_ZIP} download>leid-composer.zip</a> },
      ]}
    >
      <LegalSection number={1} title="What it is">
        <p>
          A <strong>skill</strong> is a folder of instructions that Claude loads when a task calls
          for it. The Leið composer skill kicks in when you ask Claude to make or change music with
          Leið. It works alongside the <a href="/guides/mcp">Leið connector</a>: the connector gives
          Claude the tools, and the skill teaches it to use them well.
        </p>
        <p>With the skill installed, Claude:</p>
        <ul>
          <li>follows the full workflow: read the guide, pick lines by role, preview, fix warnings, save, and hand you the link;</li>
          <li>picks lines by how many stops they have, so an ambient piece stays sparse and a groove stays tight;</li>
          <li>starts from recipes for dub, ambient, minimal techno, lo-fi and cinematic loops;</li>
          <li>edits saved songs safely, keeping the lanes you want and never overwriting a newer save;</li>
          <li>understands Leið’s warnings and fixes them instead of guessing.</li>
        </ul>
        <p>
          The skill holds no copy of Leið’s instrument or effect lists. Claude always reads those
          from the connector, so the skill stays correct as Leið gains new sounds.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Before you install">
        <ul>
          <li>You need <strong>Leið Pro</strong> and the <a href="/guides/mcp">Leið connector</a> set up in Claude. Without the connector, the skill has no tools to call.</li>
          <li>Skills need to be turned on in Claude. Look for <strong>Skills</strong> under <strong>Settings → Capabilities</strong>. On a Team or Enterprise plan, an admin may have to allow them.</li>
        </ul>
      </LegalSection>

      <LegalSection number={3} title="Install it">
        <ol>
          <li><a href={SKILL_ZIP} download>Download <code>leid-composer.zip</code></a>. Don’t unzip it.</li>
          <li>In Claude, open <strong>Settings → Capabilities → Skills</strong>.</li>
          <li>Choose <strong>Upload skill</strong> and select the zip.</li>
          <li>Make sure the skill is switched on, then start a new conversation.</li>
        </ol>
        <p>
          In <strong>Claude Code</strong>, unzip it into <code>~/.claude/skills/</code> instead. You
          should end up with <code>~/.claude/skills/leid-composer/SKILL.md</code>.
        </p>
      </LegalSection>

      <LegalSection number={4} title="Use it">
        <p>You don’t call the skill by name. Just ask for music, and Claude loads it when it fits:</p>
        <blockquote>Make me a minimal techno loop in Berlin at 126 BPM, with the bass pumping off the kick.</blockquote>
        <blockquote>Take my song “Harbour” and turn it into a lo-fi version: softer drums, piano on top.</blockquote>
        <p>
          Claude checks its plan with Leið before saving, tells you if anything had to be left out,
          and gives you a link. Open it in Leið and press <strong>Play</strong>. If it’s too busy,
          too quiet or in the wrong mood, say so. The skill knows which settings to change.
        </p>
      </LegalSection>

      <LegalSection number={5} title="Updating">
        <p>
          The skill gets new recipes from time to time. To update, download the zip again and upload
          it in place of the old one (remove the old version first if Claude asks).
        </p>
      </LegalSection>
    </GuideShell>
  )
}
