# Agents roster

Agent Mail project key: `/home/man/hack/thermal-reserve`. Registration tokens are credentials and are never recorded here.

| Role | Human | Account | Tool / model | Agent Mail name |
| --- | --- | --- | --- | --- |
| ENGINE | H2 | Claude Max | Claude Code, claude-opus-5-5 | RusticReef (since Oct 4, ~04:00 ET, pressure overhaul; earlier: GentleCompass) |
| WEB | H2 | ChatGPT Pro | Codex, gpt-6.1-sol | EmeraldHawk (since Oct 4, ~04:00 ET; earlier: TealGrove) |
| STDB | H1 | Claude Pro | Claude Code, claude-opus-5-5 | IvoryStone (since Oct 4, ~04:00 ET; merges `main`; earlier: CalmGlen, retired) |
| DATA | H3 | Claude Pro | Claude Code, claude-opus-5-5 | BlackHeron |
| CHAT | H3 | Claude Pro (H3's, shared with DATA) | Claude Code, claude-opus-5-5 | GreenGorge (since Oct 4, 04:26Z; earlier session: ScarletDesert) |

**CHAT** (added Oct 4) is the iMessage concierge + insights agent; it owns `apps/imessage/**`. It shares H3's Claude Pro usage pool with DATA; per AGENTS.md §15 either session switches to Sonnet 5.5 if Opus runs low. Brief: `docs/agents/CHAT_BRIEF.md`. Registered Oct 4, 02:29Z. In `AGENTS.md` since 56f2d06 (Who's who, layout, dependencies, model routing). Its branches (`chat/*`) are merged by STDB.

**Pressure overhaul (Oct 4, from about 04:00 Eastern).** ENGINE, WEB and STDB started new sessions for the overhaul in the current `AGENTS.md`: RusticReef (ENGINE, `engine/p-*`), EmeraldHawk (WEB, `web/p-*`) and IvoryStone (STDB, `stdb/p-*`, merge duty and deploys). Earlier names appear in older messages and in `docs/AI_LOG.md`. While DATA was offline (about 02:30–05:35 Eastern), STDB did DATA tasks D-A1 to D-B1 on H1's instruction; DATA resumed with D-B2 and D-C1 on branch `data/p-docs`.
