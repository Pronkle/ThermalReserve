# Agents roster

Agent Mail project key: `/home/man/hack/thermal-reserve`. Registration tokens are credentials and are never recorded here.

| Role | Human | Account | Tool / model | Agent Mail name |
| --- | --- | --- | --- | --- |
| ENGINE | H2 | Claude Max | Claude Code, claude-opus-5-5 | GentleCompass |
| WEB | H2 | ChatGPT Pro | Codex, gpt-6.1-sol | TealGrove |
| STDB | H1 | Claude Pro | Claude Code, claude-opus-5-5 | CalmGlen |
| DATA | H3 | Claude Pro | Claude Code, claude-opus-5-5 | BlackHeron |
| CHAT | H3 | Claude Pro (H3's, shared with DATA) | Claude Code, claude-opus-5-5 | GreenGorge (since Oct 4, 04:26Z; earlier session: ScarletDesert) |

**CHAT** (added Oct 4) is the iMessage concierge + insights agent; it owns `apps/imessage/**`. It shares H3's Claude Pro usage pool with DATA; per AGENTS.md §15 either session switches to Sonnet 5.5 if Opus runs low. Brief: `docs/agents/CHAT_BRIEF.md`. Registered Oct 4, 02:29Z. In `AGENTS.md` since 56f2d06 (Who's who, layout, dependencies, model routing). Its branches (`chat/*`) are merged by STDB.
