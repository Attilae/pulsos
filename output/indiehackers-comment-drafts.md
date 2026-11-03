# Indie Hackers comment drafts for Leið

Prepared 2 November 2026. Updated 3 November 2026. Eight posts. The first four have a main comment and a shorter alternative; choose one version per thread. Entries five through eight each have one comment drafted for the articles you selected. The first two, fifth, seventh and eighth are the strongest fits for discussing Leið naturally.

The readable Indie Hackers feed was an October snapshot. Direct access was blocked, so the first four entries are drafts for verified posts from that snapshot, not a confirmed list of today's newest posts. Entries five through eight are articles you selected separately. Entries one through five were read with their available comments; entries six through eight use the full articles and replies you supplied. Open the linked thread before using a draft to check for newer replies.

## 1 Testing AI tools in CI

**Post:** [I brought PromptBrake’s free tools into AI assistants and GitHub CI](https://www.indiehackers.com/post/i-brought-promptbrake-s-free-tools-into-ai-assistants-and-github-ci-c2d0588461)  
**Author:** Ammar / promptbrake  
**Published:** 3 October 2026

**Context:** The author asks where security checks belong. Existing replies discuss repeat usage and separating discovery traffic from real usage. A useful addition is a concrete test case involving structured output and application state.

### Main comment

CI would be the most useful starting point for me. I'm building Leið, a browser music tool where an AI composer turns a prompt into a structured arrangement. One case I'd want to test is a response that passes the schema but includes a change the user never asked for, like replacing an existing arrangement instead of adding to it. Can your test packs express an expected state change, or would I need to build that assertion around the runner?

### Shorter alternative

I'd start with CI. For an AI composer, I'd want a regression test for “valid JSON, unwanted edit” as well as prompt injection. Can the runner check which parts of the application state changed, or does that need a separate harness?

## 2 Reviewing an agent generated listing

**Post:** [I built a software directory that agents can submit to through MCP](https://www.indiehackers.com/post/i-built-a-software-directory-that-agents-can-submit-to-through-mcp-a77a476369)  
**Author:** Petr Peller / loose  
**Published:** 2 October 2026

**Context:** The author asks where an agent should stop for review. Other replies already request a preview and discuss payment and token handling. These drafts add the problem of inaccurate product claims and what should happen when an approved draft changes.

### Main comment

I'd want to approve the description and category together. I'm building Leið, which turns public transport routes into music. It's easy to describe that as a live transit music app, but the current playback uses simulated timing, so that wording would promise something it doesn't do. If an agent edits the listing after I've reviewed it, does that invalidate the approval? That's the point where I'd want it to stop again.

### Shorter alternative

The category would matter as much as the description for me. A creative tool can easily get filed as a transport utility when an agent reads the homepage. Does approval cover a fixed version of the whole listing, with another review if the agent changes it?

## 3 Trust after an anonymous report is submitted

**Post:** [We thought we were building a reporting form. We were actually building a trust system.](https://www.indiehackers.com/post/we-thought-we-were-building-a-reporting-form-we-were-actually-building-a-trust-system-68b9482861)  
**Author:** Victor B Vieira  
**Published:** 2 October 2026

**Context:** The post explains how anonymous reporting changes permissions, logging and follow-up. Existing comments cover attachment metadata, contextual identification and token leakage. These options focus on explaining the follow-up credential to the person submitting a report. No product mention needed.

### Main comment

The report-scoped credential raises an interesting onboarding question: how do you explain what happens if someone loses it? A normal password-reset flow could undermine the anonymity you're trying to preserve, but finding out later that they can't recover access would be rough too. I'd want that explained before submission, alongside a clear way to save the credential. Have you tested whether people understand that tradeoff?

### Shorter alternative

How do you handle a lost report credential? I'm curious how you explain “keep this to continue the conversation” without quietly encouraging people to identify themselves through a recovery flow.

## 4 Testing changes between approval and execution

**Post:** [Someone actually broke my stale-plan protection on purpose, and it worked](https://www.indiehackers.com/post/someone-actually-broke-my-stale-plan-protection-on-purpose-and-it-worked-2c9f3aa3a7)  
**Author:** Manan Shah  
**Published:** 21 September 2026

**Context:** A deliberately changed booking slot was blocked by a validation boundary in a fixture. The replies already explore ambiguous results after dispatch and a possible SMS test. These drafts add a separate question about multi-step plans without claiming the real integration has been proven.

### Main comment

For the real-action test, I'd be interested in a two-step plan where the first step succeeds and the second becomes stale. Blocking everything is clear in the single-action fixture; partial completion seems harder to explain to the user. Does each step get checked just before it runs, and would the user see exactly what completed before the remaining step was blocked?

### Shorter alternative

Have you tried a two-step plan where step one completes and step two becomes stale? I'd be curious what the user sees then, especially how you distinguish a blocked remainder from a plan that never ran.

## 5 Choosing the work you want to keep doing

**Post:** [Questions to Ask Yourself Before Starting](https://www.indiehackers.com/post/questions-to-ask-yourself-before-starting-0u2M46YVfpazt94oKbuV)  
**Author:** Courtland Allen  
**Published:** 14 January 2020

**Context:** Courtland recommends choosing a business around the life and work you want. His example includes avoiding excessive coding. The draft connects that point to a practical tension in building a creative product: enjoying development while still making time to reach users.

### Comment

Your point about choosing something that wouldn't require too much coding is a useful check for me. I'm building Leið, which turns public transport routes into music in the browser. A project like that has a nearly endless supply of interesting sound and interface problems to work on. The question I'd add is: am I willing to do the work that gets this into people's hands, as well as the work that makes me want to build it? Enjoying development matters, but I can see how it could also become a comfortable place to hide from finding users.

## 6 Giving the agent room to change its plan

**Post:** [19 days, $0 revenue: launching a micro-SaaS that an AI agent runs day to day](https://www.indiehackers.com/post/19-days-0-revenue-launching-a-micro-saas-that-an-ai-agent-runs-day-to-day-e99092c11e)  
**Author:** Jordan / burnproof_dev  
**Published:** 2 November 2026

**Context:** Burnproof's agent ships and operates the product, but its daily distribution routine has produced no outside scans. Existing replies cover sample reports, trust, search, community participation and misleading activity metrics. This draft asks whether the agent can revise its routine when the results show it is not working. No product mention needed.

### Comment

The morning routine is the part I'd be curious to hear more about. Can the agent decide to stop a channel that's going nowhere, or does it keep posting until you change the brief? With no outside scans yet, I'd want it to propose one small experiment and explain what result would make it change course. The human-only list could include judgment calls too, like asking you for an introduction to a potential tester through your consultancy. Has it suggested changing the distribution plan, or mostly kept executing the original one?

## 7 Keeping a direct path for people ready to build

**Post:** [438 signups, 1 paying customer: here is exactly where people drop off in my Telegram bot builder](https://www.indiehackers.com/post/438-signups-1-paying-customer-here-is-exactly-where-people-drop-off-in-my-telegram-bot-builder-22a6e4908a)  
**Author:** Alex Rel  
**Published:** 2 November 2026

**Context:** Alex's follow-up says 11 of the 15 owners whose bots reached 10+ users skipped the goal question, and all 15 published on signup day. Existing replies repeatedly suggest removing blank starts or routing everyone into a template. This draft highlights a risk in that advice: helping undecided visitors should preserve the direct path used by people who arrived ready to build.

### Comment

The detail that 11 of the 15 owners with 10+ users skipped the goal question makes me cautious about hiding the blank option. I'm building Leið, a browser music tool, so the balance between a useful starting point and room to build your own thing interests me. Your template test could help people who arrive undecided while adding friction for those who already know what they want. I'd keep a clear way to skip it and judge the test by your 14-day usage metric, not just fewer exits from the picker. Did those 11 already have a specific flow in mind when they signed up?

## 8 Making disagreement useful

**Post:** [If you can build it yourself, what’s worth paying for?](https://www.indiehackers.com/post/if-you-can-build-it-yourself-what-s-worth-paying-for-03b40428ed)  
**Author:** Arthur Yu  
**Published:** 2 November 2026

**Context:** Arthur argues that tools earn their value by helping founders interpret results and choose the next experiment. Existing replies cover time savings, maintenance, explicit assumptions and previews. This draft adds a practical test: whether disagreeing with a recommendation lets the user make a precise revision while preserving the work they want to keep.

### Comment

I'd add one more test: how much work does disagreeing with the tool create? I'm building Leið, a browser music tool with an AI composer, and that question carries over into creative work. If I like an arrangement except for the bass, I want to change the bass and keep the rest. An explanation alone doesn't give me that control. For your example, could a founder reject the audience recommendation, keep the message, and run the next experiment without starting over? Making that kind of disagreement easy would matter to me when deciding whether to pay.

## Product facts behind the drafts

Leið turns public transport routes into music in the browser: each line becomes a track and each stop becomes a note. It includes an AI composer that produces structured arrangement plans. Current playback uses simulated timing; live mode is disabled. These drafts make no claims about customer numbers, revenue, conversion improvements or distribution results.

Product reference: [Leið](https://www.layth.space/). The comments omit a promotional link so the contribution can stand on its own.
