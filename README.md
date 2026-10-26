# Claude Session Usage

**Ever hit your Claude limit halfway through the day with no idea which session burned through it?**

Three sessions open, Opus in one, Sonnet in another, and Claude Code only tells you "80% used". This plugin shows you, for every session, how much of your 5-hour and weekly limits it used and which model did it.

<p align="center"><img src="docs/usage-pane.svg" alt="The Usage pane" width="400"></p>

## What it shows

- **Tokens by model**: how this session's tokens split between models
- **Share of 5h / weekly usage**: how much of each window's usage came from this session
- **All Usage**: your 5-hour and weekly limits with time left, colored by model across all sessions

## Install

Requires a Claude subscription (such as Pro or Max).

**Desktop app:** click **+** next to the prompt box → **Plugins** → **Add marketplace** → enter `Mahdi-Alz/claude-session-usage` → **Add plugin**.

**Terminal:** at the Claude Code prompt, run

```
/plugin install usage-monitor --marketplace Mahdi-Alz/claude-session-usage
```

Start a new session and the pane opens on its own. Type `/usage-monitor` to reopen it.

## Good to know

The totals and time left come from Claude Code. The split by session and model is an estimate, weighted by each model's price, and only counts sessions running the plugin. Usage from elsewhere, like claude.ai, shows as grey.

To uninstall: `claude plugin uninstall usage-monitor`

## License

MIT
