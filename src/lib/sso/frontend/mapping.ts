import type { DraftRow, MappingRow, PhoneSuggestions, SetupContext } from './types'

export function draftRows(rows: MappingRow[]): DraftRow[] {
  return rows.map(({ local_user_id, sso_user_id, selection_source }) => ({
    local_user_id,
    sso_user_id,
    selection_source,
  }))
}

export function restoreRows(
  context: SetupContext,
  previous: MappingRow[] = [],
  preserveEdits = true
): MappingRow[] {
  return context.users.map((user) => {
    const draft = context.draft_rows?.find((row) => row.local_user_id === user.local_user_id)
    const old = previous.find((row) => row.local_user_id === user.local_user_id)
    const unsaved = preserveEdits && old && (old.edited || (!old.saved && old.sso_user_id !== null))
    const row: MappingRow =
      user.sso_user_id !== null
        ? {
            local_user_id: user.local_user_id,
            sso_user_id: user.sso_user_id,
            selection_source: 'manual',
            stale: draft?.stale === true,
          }
        : unsaved
          ? { ...old, stale: draft?.stale === true }
          : draft
            ? { ...draft, saved: true }
            : { local_user_id: user.local_user_id, sso_user_id: null, selection_source: 'manual' }
    // 保存进度只确认原账号快照，不能把已失效的手机号建议重新当作有效。
    if (
      row.selection_source === 'phone' &&
      old?.selection_source === 'phone' &&
      row.sso_user_id !== null &&
      row.sso_user_id === old.sso_user_id
    )
      row.issue = old.issue
    return row
  })
}

export function rowIssue(context: SetupContext, row: MappingRow): string {
  if (row.stale) return '原账号资料已变化，请核对后保存进度'
  if (row.issue) return row.issue
  if (row.sso_user_id === null) return ''
  if (!context.roster.length) return '尚未读取人员名单，请连接佳选后刷新'
  const person = context.roster.find((item) => item.user_id === row.sso_user_id)
  return !person || person.status !== 1 ? '所选人员已停用或不在本应用名单中，请重新选择' : ''
}

export function applySuggestions(
  context: SetupContext,
  rows: MappingRow[],
  result: PhoneSuggestions
) {
  const chosen = new Set(rows.flatMap((row) => (row.sso_user_id === null ? [] : [row.sso_user_id])))
  for (const row of rows) {
    if (context.users.find((user) => user.local_user_id === row.local_user_id)?.sso_user_id !== null)
      continue
    const suggestion = result.suggestions.find((item) => item.local_user_id === row.local_user_id)
    const candidate = suggestion?.status === 'matched' ? suggestion.candidate : null
    if (row.sso_user_id !== null) {
      if (row.selection_source === 'phone') {
        row.issue = candidate?.user_id === row.sso_user_id ? '' : '手机号推荐已变化，请重新选择对应人员'
      }
      continue
    }
    if (
      !candidate ||
      row.edited ||
      candidate.status !== 1 ||
      chosen.has(candidate.user_id) ||
      !context.roster.some((person) => person.user_id === candidate.user_id && person.status === 1)
    )
      continue
    row.sso_user_id = candidate.user_id
    row.selection_source = 'phone'
    row.saved = false
    row.issue = ''
    chosen.add(candidate.user_id)
  }
}

export function validateMapping(context: SetupContext, rows: MappingRow[]): string {
  if (
    rows.length !== context.users.length ||
    new Set(rows.map((row) => row.local_user_id)).size !== context.users.length
  )
    return '请确认全部原账号'
  const chosen = new Set<number>()
  for (const user of context.users) {
    const row = rows.find((item) => item.local_user_id === user.local_user_id)
    if (!row) return '请确认全部原账号'
    if (user.sso_user_id !== null && row.sso_user_id !== user.sso_user_id)
      return '已有账号关联不能被覆盖'
    const issue = rowIssue(context, row)
    if (issue) return issue
    if (row.sso_user_id === null) continue
    if (!Number.isSafeInteger(row.sso_user_id) || row.sso_user_id <= 0)
      return `请为 ${user.username} 选择有效佳选账号`
    if (chosen.has(row.sso_user_id!)) return '多个原账号不能关联重复的佳选账号'
    chosen.add(row.sso_user_id!)
  }
  if (
    !context.users.some(
      (user) =>
        user.is_admin &&
        user.is_enabled &&
        rows.some((row) => row.local_user_id === user.local_user_id && row.sso_user_id !== null)
    )
  )
    return '至少关联一名启用的原管理员才能完成接入'
  return ''
}
