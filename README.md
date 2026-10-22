# task-lens

A Claude Code mod that shows what your subagents, background shells and workflows are doing, and why, in a band above the prompt. No side panel: it stays in the same terminal.

```
  ▶ [read] Find VM deletion flow · 0:13
    Tracing the VM delete flow through the code
  ▶ [plan] Plan Excel export refactor · 0:41
    Designing a shared export helper
  ▶ [code] Fix alarm formatter · 1:02
    Changing the rounding to fix the alarm values
    ⏳ 1:10
  ▶ [test] $ gradlew test · 2:10
    Checking the fix does not break existing tests
  ▶ review · 3/7 · 4:02
    find:logic · Looking for state-change bugs
  ✗ [run] $ lint · 0:40
    → exit 1
```

## What it shows

- **One purpose sentence per running task.** Haiku writes it from the task's instructions and recent actions, and rewrites it when the stage changes (every 5 tool calls, at most every 20 seconds). File names and search terms are not shown. Long sentences wrap to two lines.
- **What kind of work it is doing right now**, as a tag in front of the title. The tag follows the current stage, so an agent that designs, then codes, then designs again moves between `[plan]` and `[code]`:

  | Tag | Meaning |
  |---|---|
  | `[read]` | investigating, reading or searching |
  | `[code]` | changing code |
  | `[plan]` | designing |
  | `[docs]` | writing documents |
  | `[test]` | verifying or testing |
  | `[run]` | building, deploying or running something |

  Haiku picks the tag together with the purpose sentence. The moment an agent starts editing files, the tag switches to `[code]` (or `[docs]` for `.md` and other text files) without waiting for Haiku. Before Haiku answers, the tag is guessed from the tools and commands used.
- **Symbols and numbers only for everything else**, so the band works in any language: `▶` running, `✓` done, `✗` failed, `■` stopped, `$` background shell, `n/m` workflow progress, `1:12` elapsed time, `⏳` time since the last sign of progress (shown after a minute), `→` result.
- **Results stay until your next message.** A finished task keeps a one-line result; the band clears it when you send your next prompt.

## Language

Purpose and result sentences follow the language of your last prompt (Korean, English, Japanese, and so on). To always use one language, set the plugin's `language` option to a language name, for example `Japanese`. The default is `auto`.

## Commands

- `/lens` lists every tracked task with its purpose or result.
- `/lens clear` removes finished tasks from the band.

## Privacy

Secrets in commands (tokens, passwords, `Authorization` headers, URL credentials) are masked before anything is drawn or sent to Haiku. Haiku is called through Claude Code's own model access; nothing is sent anywhere else.

## Install

At the prompt of a terminal session:

```
/plugin install task-lens --marketplace delpotro96/task-lens
```

From a shell:

```
claude plugin install task-lens --marketplace delpotro96/task-lens
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `delpotro96/task-lens`, then Add plugin.

Answer `y` to add the marketplace, then pick a scope.

## Update

Third-party marketplaces do not auto-update by default. To update:

```
/plugin marketplace update task-lens
/plugin update task-lens@task-lens
```

then run `/reload-plugins`. To get updates automatically, open `/plugin`, go to Marketplaces, select `task-lens` and choose Enable auto-update.
