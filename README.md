# usage-monitor

A Claude Code pane that shows where your tokens go in the current session and how much of your plan's 5-hour and weekly limits it has used.

## What it shows

**Current Session**

- **Tokens by model**: a bar split by model, with each model's token count and its share of the session
- **Share of 5h usage** and **Share of weekly usage**: how much of the usage so far in each window came from this session, plus its share of the whole limit

**All Usage**

- **5h** and **Weekly** bars with time left until reset, split by model across every session that runs the mod. Grey is usage the mod didn't see (claude.ai, other machines, or before it was installed)

Each model family has a fixed color: Opus crimson, Sonnet purple, Haiku green. Older versions of a family use a lighter shade.

## Install

At the prompt of a terminal session:

```
/plugin install usage-monitor --marketplace Mahdi-Alz/claude-session-usage
```

From a shell:

```
claude plugin install usage-monitor --marketplace Mahdi-Alz/claude-session-usage
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `Mahdi-Alz/claude-session-usage`, then Add plugin.

The pane opens when a session starts. Run `/usage-monitor` to open it again after closing it.

## How the numbers are worked out

Claude Code reports the 5-hour and weekly limits as a single percentage for your account, with no breakdown by session or model. The mod fills that in:

- Each session records its own tokens per model and saves them to storage shared by all sessions on the machine
- Tokens are weighted by relative price (Opus more than Sonnet, Sonnet more than Haiku, output more than input, cache reads much less) to estimate how much each one counts toward the limit
- The usage already on the limit when the mod first sees a window counts as untracked
- The rest is split between sessions and models by their weighted usage

So the per-session and per-model shares are estimates. The total percentage and the time left come straight from Claude Code.

The limits only show for accounts on a subscription plan, after the first reply of a session or from the last reading saved by another session.
