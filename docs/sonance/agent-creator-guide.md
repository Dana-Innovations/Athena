# Athena Agent Creator Guide

**Audience:** Sonance employees who want to build a new AI agent on the Athena platform.
**Prerequisites:** Basic familiarity with YAML. No coding required for simple agents.

---

## What is an Athena Agent?

An Athena agent is an AI assistant that:

- Has its own personality and expertise (defined in a `SOUL.md` file)
- Runs inside Microsoft Teams (or other gateways) with a dedicated identity
- Can use tools: M365 calendar, email, web search, code execution, and more
- Can collaborate with other agents (Athena can ask Scheduler for availability, etc.)
- Can run on a schedule (cron jobs for daily briefings, weekly summaries, etc.)

---

## Step 1: Copy the Template

```bash
cp -r agents/definitions/scheduler agents/definitions/your-agent-name
```

You'll have two files to edit:

- `agents/definitions/your-agent-name/agent.yaml` — the agent's configuration
- `agents/definitions/your-agent-name/SOUL.md` — the agent's personality and instructions

---

## Step 2: Edit `agent.yaml`

Here's a minimal example:

```yaml
apiVersion: athena/v1
kind: Agent
metadata:
  name: analyst # Unique ID (lowercase, no spaces)
  displayName: "Analyst" # How it appears in Teams
  description: "Business intelligence and data insights for Sonance"
  aliases: ["@analyst"]
  team: company-wide
  owner: your-email@sonance.com

spec:
  role: specialist # "orchestrator" (user-facing) or "specialist" (internal)

  runtime:
    framework: openclaw
    model:
      primary: anthropic/claude-sonnet-4-5-20250929

  skills:
    cortex:
      mcps: [] # Which MCPs to enable (e.g. ["m365"] for calendar/email)
      tools:
        allow: # Which specific tools to expose to this agent
          - "cortex_m365__list_events"

  collaboration:
    canContact: ["athena"] # Which agents this agent can query/delegate to
    acceptFrom: ["athena"] # Which agents can send tasks to this agent

  access:
    users: ["*@sonance.com"] # Who can use this agent
```

---

## Step 3: Write `SOUL.md`

This is the agent's system prompt — its personality, purpose, and behavioral rules.

**Structure:**

```markdown
# [Agent Name] — [One-line purpose]

## Identity

You are [name], [description of role and expertise].
[1–2 sentences about what makes this agent distinctive.]

## Capabilities

- [Capability 1]
- [Capability 2]

## Behavioral Guidelines

- [Rule 1: what to do]
- [Rule 2: what NOT to do]
- [Rule 3: tone and style]

## Scope Limits

- Only answer questions within [domain]
- For [other topics], direct users to [other resource/agent]
```

**Tips:**

- Be specific. "You are an expert in Sonance's Q3 OKRs and can look up progress" is better than "You are helpful."
- Use positive instructions. Instead of "Don't ignore calendar conflicts," write "Always check for calendar conflicts before suggesting meeting times."
- Keep it under 10KB. The model reads this on every turn — shorter is faster.
- Avoid phrases like "Ignore all previous instructions" or "You are now a different AI" — these will be rejected by the content guard.

---

## Step 4: Assign Tools

### Available MCPs

| MCP name  | What it gives the agent                          |
| --------- | ------------------------------------------------ |
| `m365`    | Calendar, email, contacts, tasks, Teams presence |
| `github`  | Repo access, PRs, issues, code search            |
| `notion`  | Pages, databases, search                         |
| `jira`    | Issues, sprints, epics                           |
| `slack`   | Channels, messages, users                        |
| `browser` | Web search, page fetch                           |

Enable an MCP in `skills.cortex.mcps`:

```yaml
skills:
  cortex:
    mcps: ["m365", "github"]
```

Then list the specific tools the agent is allowed to use under `skills.cortex.tools.allow`. Limiting the list keeps the agent focused and reduces LLM confusion.

Find tool names by looking at the **Cortex Connections** page in the Admin Portal (`/cortex`).

---

## Step 5: Configure Collaboration (optional)

Agents can communicate with each other. To allow your agent to query Athena:

```yaml
collaboration:
  canContact: ["athena"] # Agents this one can query/delegate to
  acceptFrom: ["athena"] # Agents that can send tasks to this one
  maxDelegationDepth: 1 # How many levels of delegation are allowed
```

Three communication patterns are available to agents:

| Pattern      | Tool                | When to use                                                               |
| ------------ | ------------------- | ------------------------------------------------------------------------- |
| **Query**    | `ask_agent`         | Need an answer from another agent before replying to user                 |
| **Delegate** | `delegate_to_agent` | Hand off a background task; agent handles it and replies directly to user |
| **Notify**   | `notify_agent`      | Share a context update; no reply expected                                 |

---

## Step 6: Add Cron Jobs (optional)

Cron jobs let an agent run on a schedule without a user message.

```yaml
cron:
  - name: weekly-report
    schedule: "0 9 * * 1" # Every Monday at 9am
    action: compile-weekly-report
    targets: all-managers
```

`schedule` uses standard cron syntax: `minute hour day-of-month month day-of-week`.

The `action` is a string your SOUL.md should reference — the agent sees it as the trigger prompt.

---

## Step 7: Restart the Gateway

After saving your files, restart the Athena gateway so it picks up the new agent:

**Local dev:**

```bash
# Kill the running gateway process and restart it
```

**Azure (production):**

1. Push to the `main` branch
2. Open the Admin Portal → **Deployment** → click **Restart Gateway**

The new agent will appear in the **Agents** page within 30 seconds.

---

## Step 8: Test in Teams

1. Open a Teams chat
2. Type `/your-agent-name hello` (or use the alias you configured)
3. The agent should respond

If it doesn't respond, check:

- **Admin Portal → Agents** — is the agent listed? Are there errors?
- **Admin Portal → Deployment** — is the agent shown as Active?
- **Admin Portal → Audit** — are there any config error events?

---

## Using the Admin Portal

The Admin Portal lives at the Athena web app (`/platform` tab group).

| Page              | What you can do                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| **Agents**        | View stats, edit SOUL.md, roll back to previous versions, create/delete agents |
| **Conversations** | Browse all conversations, search message history                               |
| **Memory**        | View and delete per-user memory entries                                        |
| **Cron**          | See scheduled job status and recent run history                                |
| **Audit**         | Full log of config changes, SOUL.md edits, and system events                   |
| **Deployment**    | Live topology — which agents are active, their gateways and tools              |

---

## Common Mistakes

| Mistake                     | Fix                                                                          |
| --------------------------- | ---------------------------------------------------------------------------- |
| Agent doesn't appear        | Check `metadata.name` is unique and lowercase                                |
| Agent uses wrong tools      | Check `skills.cortex.tools.allow` — tools not listed here won't be available |
| Agent replies to everyone   | Set `access.users` to restrict to specific emails or domains                 |
| SOUL.md save fails          | Content may have hit the 500KB limit or matched an injection pattern         |
| Agent can't reach Scheduler | Check `collaboration.canContact` includes `"scheduler"`                      |

---

## Getting Help

- Post in `#athena-agents` on Teams
- Tag `@josh` or `@elliott` for platform issues
- File bugs at the Athena GitHub repo
