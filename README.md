# task-lens

A Claude Code mod that shows what your subagents, background shells and workflows are doing, and why, in a band above the prompt. No side panel: it stays in the same terminal.

```
▶ 2  ✓ 3  ✗ 1
  ▶ Trace the alarm output path · 1:12
    Following the formatter calls to find why values differ
    ⏳ 3:05
  ▶ $ gradle test · 6:40
    Checking the fix does not break existing tests
  ▶ review · 3/7 · 4:02
    find:logic · Looking for state-change bugs
  ✗ lint · 0:40
    → 2 failures, unused import
```

- One purpose sentence per running task, written by Haiku from the task's instructions and recent actions, refreshed when the stage changes. File names and search terms are not shown.
- The band itself uses only symbols and numbers: `▶` running, `✓` done, `✗` failed, `■` stopped, `$` shell, `n/m` workflow progress, `⏳` time since the last progress, `→` result.
- Sentences follow the language of your last prompt. Set the `language` option to a language name (for example `Japanese`) to always use it.
- Finished tasks keep a result line until you send your next message. `/lens` lists everything; `/lens clear` removes finished tasks.
- Secrets in commands (tokens, passwords, `Authorization` headers) are masked before anything is drawn or sent to Haiku.

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
