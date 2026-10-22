import { expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

const BAND = {
  plugin: 'task-lens',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const SPAWN = {
  tool_use_id: 'toolu_agent',
  prompt: 'QATAB-806 관측값 출력 경로를 조사해라',
  description: '출력 경로 조사',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

const LENS = (args: string): CommandRunInput => ({
  command: 'lens',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
})

const TURN = { turnId: 't1', durationMs: 1000, isAborted: false, model: 'haiku' } as const

// 엔진 자리를 대신하는 하단 응답들, Haiku 는 호출마다 번호를 붙인 목적 문장을 돌려준다
function engine(on: On, haiku: { prompts: string[]; systems?: string[]; tag?: string; fail?: boolean } = { prompts: [] }) {
  const clock = mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('command.register', () => ({ value: { command: 'lens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let spawned = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: `a${++spawned}` }))
  let toolAnswer: () => object = () => ({ result: { stdout: '', stderr: '', interrupted: false } })
  on('tool.call', () => toolAnswer() as never)
  on('command.run', () => ({ text: 'engine' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', (_, e) => {
    haiku.prompts.push(e.prompt)
    haiku.systems?.push(e.system ?? '')
    if (haiku.fail) return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } }
    const text = e.system?.includes('요약') || e.system?.includes('summarize') ? '원인은 포맷 함수의 반올림' : `목적 문장 ${haiku.prompts.length}`
    return { value: { isAnswered: true as const, text: `생각 중
${haiku.tag ? `<c>${haiku.tag}</c>` : ''}<s>${text}</s>`, usage: USAGE } }
  })
  return {
    settle: () => clock.settle(),
    advance: (ms: number) => clock.advance(ms),
    tool: (f: () => object) => {
      toolAnswer = f
    },
  }
}

const texts = async (ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text: string } | undefined> }, re: RegExp) =>
  (await ui.find({ type: 'Text', text: re }))?.text

test('a subagent shows its purpose sentence, never its raw actions', async ($, on) => {
  const haiku = { prompts: [] as string[] }
  const clock = engine(on, haiku)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.settle()

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /^▶ \d/)).toBeUndefined()
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [read] 출력 경로 조사 · 0:00')
  expect(await texts(ui, /목적 문장/)).toBe('    목적 문장 1')
  expect(haiku.prompts[0]).toContain('<data>')
  expect(haiku.prompts[0]).toContain('QATAB-806 관측값 출력 경로를 조사해라')
  await ui.unmount()

  for (let i = 0; i < 5; i++) {
    await $.tool.call({ tool: 'Grep', pattern: 'formatObservation', path: 'C:\\repo\\core-cmp', agentId: 'a1' })
  }
  await clock.advance(10_000)
  expect(haiku.prompts.length).toBe(1)
  await clock.advance(11_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(haiku.prompts.length).toBe(2)
  expect(haiku.prompts[1]).toContain('Grep formatObservation')
  expect(await texts(ui, /목적 문장/)).toBe('    목적 문장 2')
  expect(await texts(ui, /formatObservation|Grep|읽는 중/)).toBeUndefined()
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [read] 출력 경로 조사 · 0:21')
  expect(await texts(ui, /engine/)).toBe('engine')
  await ui.unmount()
})

test('a step that takes long gets a dim stall note', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Bash', command: './gradlew build', description: 'build', agentId: 'a1' })
  await clock.advance(3 * 60_000 + 5_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /⏳/)).toBe('    ⏳ 3:05')
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [read] 출력 경로 조사 · 3:05')
  await ui.unmount()
})

test('a finished agent shows the reason it ended and a summary', async ($, on) => {
  const haiku = { prompts: [] as string[] }
  const clock = engine(on, haiku)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'e', description: '오류 난 작업' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'k', description: '중지한 작업' })
  await clock.settle()
  const before = haiku.prompts.length

  await $.turn.complete({ ...TURN, agentId: 'a1', answer: '## 완료\n\n1. **원인**: 반올림', reason: 'answer' })
  await $.turn.complete({ ...TURN, agentId: 'a2', answer: '', reason: 'error' })
  await $.turn.complete({ ...TURN, agentId: 'a3', answer: '', isAborted: true, reason: 'aborted' })
  await clock.settle()
  expect(haiku.prompts.length).toBe(before + 1)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /^▶ \d/)).toBeUndefined()
  expect(await texts(ui, /원인은/)).toBe('    → 원인은 포맷 함수의 반올림')
  expect(await texts(ui, /오류 난 작업/)).toBe('  ✗ [read] 오류 난 작업 · 0:00')
  expect(await texts(ui, /중지한 작업/)).toBe('  ■ [read] 중지한 작업 · 0:00')
  await ui.unmount()
})

test('without Haiku the result falls back to the first content line', async ($, on) => {
  const clock = engine(on, { prompts: [], fail: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.settle()
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // Haiku 가 답하지 못하면 '파악하는 중' 을 계속 띄우지 않는다
  expect(await texts(ui, /파악하는 중/)).toBeUndefined()
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [read] 출력 경로 조사 · 0:00')
  await ui.unmount()

  await $.turn.complete({ ...TURN, agentId: 'a1', answer: '## 완료\n\n1. **완료**: `A.java:1` 수정', reason: 'answer' })
  await clock.settle()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /→/)).toBe('    → 완료: A.java:1 수정')
  await ui.unmount()
})

test('a background shell ends by its notification and clears only on a person\'s prompt', async ($, on) => {
  const clock = engine(on)
  clock.tool(() => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
    text: 'Command running in background with ID: b1. Output is being written to: C:\\tmp\\b1.output. You will be notified',
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: './gradlew :service-cmp:test', description: 'service-cmp 테스트', run_in_background: true })
  await clock.settle()

  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 1)</summary>\n</task-notification>',
    isMeta: true,
    origin: { kind: 'task-notification' },
    wait: false,
  })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /service-cmp 테스트/)).toBe('  ✗ [test] $ service-cmp 테스트 · 0:00')
  expect(await texts(ui, /→/)).toBe('    → exit 1')
  await ui.unmount()

  await $.prompt.submit({ text: 'hidden', isMeta: true, origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: 'from a peer', origin: { kind: 'peer' }, wait: false })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /service-cmp/)).toBeDefined()
  await ui.unmount()

  await $.prompt.submit({ text: '다음 질문', origin: { kind: 'composer' }, wait: false })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /service-cmp/)).toBeUndefined()
  expect(await texts(ui, /engine/)).toBe('engine')
  await ui.unmount()
})

test('secrets and control characters never reach the band or Haiku', async ($, on) => {
  const haiku = { prompts: [] as string[] }
  const clock = engine(on, haiku)
  let n = 0
  clock.tool(() => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `s${++n}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const leaks = [
    ['curl -H "PRIVATE-TOKEN: glpat-abcdef123456" https://h', 'glpat'],
    ['curl -u admin:s3cret https://h/api', 's3cret'],
    ['mysql -uroot -pS3cretPw tabcloudit', 'S3cretPw'],
    ["mysql -uroot -p'Quoted9pw' -e 'select 1'", 'Quoted9pw'],
    ['git clone https://lkh:pw1234567@gitlab/x.git', 'pw1234567'],
    ['AWS_SECRET_ACCESS_KEY=abcd1234 aws s3 ls', 'abcd1234'],
    ['sshpass -p Hunter2pw ssh host', 'Hunter2pw'],
    ['docker login -u me -p DockPw77 registry', 'DockPw77'],
    ['curl -H "Authorization: Basic dXNlcjpwYXNz" h', 'dXNlcjpwYXNz'],
  ] as const
  for (const [command] of leaks) await $.tool.call({ tool: 'Bash', command, run_in_background: true })
  await clock.settle()
  const sent = haiku.prompts.join('\n')
  expect(haiku.prompts.length).toBe(leaks.length)
  for (const [, leak] of leaks) expect(sent).not.toContain(leak)
  for (const keep of ['mkdir -p dir && ssh -p 22 host', 'echo max_tokens=4096', 'echo Basic settings']) {
    await $.tool.call({ tool: 'Bash', command: keep, run_in_background: true })
  }
  await clock.settle()
  const all = haiku.prompts.join('\n')
  expect(all).toContain('mkdir -p dir && ssh -p 22 host')
  expect(all).toContain('max_tokens=4096')
  expect(all).toContain('Basic settings')

  await $.tool.call({ tool: 'Bash', command: 'x', description: 'title\x1b]0;evil\x07 \x1b[31mred\x1b[0m\x08', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'rg -n formatObservation core-cmp/src', run_in_background: true })
  await clock.settle()
  // 띠는 14줄까지라 13개 셸 전부를 /lens 로 확인한다
  const listed = (await $.command.run(LENS(''))).text
  expect(listed).toContain('▶ [run] $ title red · 0:00')
  expect(listed).toContain('▶ [read] $ rg · 0:00')
  expect(listed).toContain('▶ [run] $ aws · 0:00')
  for (const hidden of ['formatObservation', 'glpat', 's3cret', 'abcd1234', 'evil']) expect(listed).not.toContain(hidden)
})

test('a workflow child shows its own title before its purpose, and a shell ends with its parent', async ($, on) => {
  const clock = engine(on)
  let n = 0
  clock.tool(() =>
    ++n === 1
      ? { result: { status: 'async_launched', taskId: 'w9', workflowName: 'review' } }
      : { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'sh1', backgroundEndsWithFinalResponse: true } },
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf2', script: "export const meta = { name: 'review', description: '변경을 검토' }" })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_wf2', description: 'find:logic' })
  await $.tool.call({ tool: 'Bash', command: 'gradle test', description: 'unit tests', run_in_background: true, agentId: 'a1' })
  await clock.settle()
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /find:logic/)).toMatch(/^ {4}find:logic · 목적 문장 \d+$/)
  await ui.unmount()

  await $.turn.complete({ ...TURN, agentId: 'a1', answer: 'ok', reason: 'answer' })
  await clock.settle()
  expect((await $.command.run(LENS(''))).text).toContain('■ [test] $ unit tests · 0:00')
})

test('a quiet shell output shows how long it has been unchanged', async ($, on) => {
  const clock = engine(on)
  clock.tool(() => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2' },
    text: 'Output is being written to: C:\\tmp\\b2.output. You will be notified',
  }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 40, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'compiling\nBUILD \x1b[32mOK\x1b[0m token=abc\n' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'gradle', description: 'gradle build', run_in_background: true })
  await clock.advance(3_000)
  await clock.advance(2 * 60_000 + 10_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /⏳/)).toBe('    ⏳ 2:10 · BUILD OK token=***')
  await ui.unmount()
})

test('a workflow groups its agents and keeps progress until it ends', async ($, on) => {
  const clock = engine(on)
  clock.tool(() => ({ result: { status: 'async_launched', taskId: 'w1', workflowName: 'review' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: "export const meta = { name: 'review', description: '변경을 검토' }" })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_wf', description: 'find:logic' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_wf', description: 'find:ux', prompt: 'ux' })
  await clock.settle()
  await $.turn.complete({ ...TURN, agentId: 'a1', answer: 'ok', reason: 'answer' })
  await $.prompt.submit({ text: '진행 중 질문', origin: { kind: 'composer' }, wait: false })
  await clock.settle()

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /review/)).toBe('  ▶ review · 1/2 · 0:00')
  expect(await texts(ui, /변경을 검토/)).toBe('    변경을 검토')
  await ui.unmount()

  await $.prompt.submit({
    text: '<task-notification><task-id>w1</task-id><status>completed</status><summary>done</summary></task-notification>',
    origin: { kind: 'task-notification' },
    isMeta: true,
    wait: false,
  })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /review/)).toBe('  ✓ review · 2/2 · 0:00')
  expect(await texts(ui, /^▶ \d/)).toBeUndefined()
  await ui.unmount()
})

test('when tasks overflow, titles stay and the rest folds into a count', async ($, on) => {
  const clock = engine(on)
  let n = 0
  clock.tool(() => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `o${++n}` } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 5; i++) await $.tool.call({ tool: 'Bash', command: 'x', description: `job${i}`, run_in_background: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 4 } })
  expect(await texts(ui, /job1/)).toBeDefined()
  expect(await texts(ui, /job2/)).toBeDefined()
  expect(await texts(ui, /job3/)).toBeDefined()
  expect(await texts(ui, /job4/)).toBeUndefined()
  expect(await texts(ui, /\+\d …/)).toBe('  +2 …')
  await ui.unmount()
})

test('/lens lists tasks briefly and clear says how many it removed', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(LENS(''))).text).toBe('∅')
  await $.agent.spawn(SPAWN)
  await clock.settle()
  await $.turn.complete({ ...TURN, agentId: 'a1', answer: 'ok', reason: 'answer' })
  await clock.settle()
  const list = (await $.command.run(LENS(''))).text
  expect(list).toBe('✓ [read] 출력 경로 조사 · 0:00\n    → 원인은 포맷 함수의 반올림')
  expect((await $.command.run(LENS('clear'))).text).toBe('✓ −1')
})

test('teammates are not tracked', async ($, on) => {
  const haiku = { prompts: [] as string[] }
  const clock = engine(on, haiku)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, isTeammate: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /출력 경로 조사/)).toBeUndefined()
  expect(haiku.prompts.length).toBe(0)
  await ui.unmount()
})

test('a fixed language option tells Haiku which language to write in', { options: { language: 'Japanese' } }, async ($, on) => {
  const systems: string[] = []
  const clock = engine(on, { prompts: [], systems })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.advance(72_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /^▶ \d/)).toBeUndefined()
  expect(await texts(ui, /出力|출력 경로 조사/)).toBe('  ▶ [read] 출력 경로 조사 · 1:12')
  expect(systems.some(s => s.endsWith('Write in Japanese.'))).toBe(true)
  await ui.unmount()
})

test('auto language follows the last prompt the person sent', async ($, on) => {
  const haiku = { prompts: [] as string[] }
  const clock = engine(on, haiku)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'このバグを調べて', origin: { kind: 'composer' }, wait: false })
  await $.agent.spawn(SPAWN)
  await clock.settle()
  expect(haiku.prompts[0]).toContain('<lang-sample>\nこのバグを調べて\n</lang-sample>')
})

test('a long line wraps to two rows instead of being cut', async ($, on) => {
  const clock = engine(on, { prompts: [], fail: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  const answer = '알람 관측값이 메일과 엑셀에서 다르게 찍히는 원인은 포맷 함수의 반올림 자리수가 서로 달라서였습니다'
  await $.turn.complete({ ...TURN, agentId: 'a1', answer, reason: 'answer' })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 60 } })
  const first = await texts(ui, /→/)
  expect(first?.startsWith('    → 알람 관측값이')).toBe(true)
  expect(first?.endsWith('…')).toBe(false)
  expect(await texts(ui, /^ {4}(?!→).*달라서였습니다$/)).toBeDefined()
  await ui.unmount()
})

test('the kind tag comes from Haiku when it gives one, and from the tools otherwise', async ($, on) => {
  const haiku = { prompts: [] as string[], tag: 'plan' }
  const clock = engine(on, haiku)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.settle()
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [plan] 출력 경로 조사 · 0:00')
  await ui.unmount()

  haiku.tag = ''
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_b', description: '문서 정리' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\README.md', old_string: 'a', new_string: 'b', agentId: 'a2' })
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_c', description: '코드 수정' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\A.java', old_string: 'a', new_string: 'b', agentId: 'a3' })
  await clock.settle()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /문서 정리/)).toBe('  ▶ [docs] 문서 정리 · 0:00')
  expect(await texts(ui, /코드 수정/)).toBe('  ▶ [code] 코드 수정 · 0:00')
  await ui.unmount()
})

test('starting to edit files switches the tag right away, before Haiku refreshes', async ($, on) => {
  const haiku = { prompts: [] as string[], tag: 'plan' }
  const clock = engine(on, haiku)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.settle()
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [plan] 출력 경로 조사 · 0:00')
  await ui.unmount()

  await $.tool.call({ tool: 'Edit', file_path: 'C:\repo\A.java', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await clock.settle()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [code] 출력 경로 조사 · 0:00')
  await ui.unmount()

  await $.tool.call({ tool: 'Write', file_path: 'C:\repo\docs\guide.md', content: 'x', agentId: 'a1' })
  await clock.settle()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await texts(ui, /출력 경로 조사/)).toBe('  ▶ [docs] 출력 경로 조사 · 0:00')
  await ui.unmount()
})

test('in VS Code the same lines open in a pane, since the band is not drawn there', async ($, on) => {
  const clock = engine(on)
  const opened: string[] = []
  on('session.surfaces', () => ({ value: ['vscode' as const] }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await clock.settle()
  expect(opened).toContain('task-lens')

  const pane = await $.ui.mount({
    plugin: 'task-lens',
    component: 'Pane',
    requestId: 'task-lens',
    surface: 'vscode',
    props: { title: 'task-lens', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await pane.find({ type: 'Text', text: /출력 경로 조사/ }))?.text).toBe('  ▶ [read] 출력 경로 조사 · 0:00')
  expect((await pane.find({ type: 'Text', text: /목적 문장/ }))?.text).toBe('    목적 문장 1')
  await pane.unmount()
})
