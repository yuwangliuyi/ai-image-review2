'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Save, CheckCircle2, LogOut, Undo2 } from 'lucide-react';
import { useSsoApp } from '@/components/sso/SsoAppGate';
import { ApiError } from '@/lib/sso/frontend/transport';
import { SignedOutError } from '@/lib/sso/frontend/sign-out';
import { assertMode } from '@/lib/sso/frontend/startup';
import {
  applySuggestions,
  draftRows,
  restoreRows,
  rowIssue,
  validateMapping,
} from '@/lib/sso/frontend/mapping';
import type { MappingRow, PhoneSuggestions, SetupContext } from '@/lib/sso/frontend/types';

/**
 * 接入向导（固定根路径 /sso-setup，兼容 ?connect=1）。
 * 登录页、菜单栏、顶部及业务页面不添加本入口。
 */
export default function SsoSetupPage() {
  const { phase, mode, api, user, refreshUser } = useSsoApp()
  const [context, setContext] = useState<SetupContext | null>(null)
  const [rows, setRows] = useState<MappingRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [suggestionMessage, setSuggestionMessage] = useState('')
  const [allowUnmapped, setAllowUnmapped] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)

  const updateContext = useCallback(
    (next: SetupContext, options: { preserveRows?: boolean; roster?: SetupContext['roster'] } = {}) => {
      assertMode(next)
      setAllowUnmapped(false)
      const merged = { ...next, roster: options.roster ?? next.roster }
      setContext(merged)
      setRows((previous) => restoreRows(merged, previous, options.preserveRows === true))
      if (next.phase !== 'MAPPING_REQUIRED') setSuggestionMessage('')
    },
    []
  )

  const handleError = useCallback(
    async (caught: unknown) => {
      if (caught instanceof SignedOutError) return
      setNotice('')
      setError(caught instanceof Error ? caught.message : '操作未完成，请稍后重试')
      if (caught instanceof ApiError && caught.code === 'REVISION_CONFLICT') {
        try {
          const latest = await fetch('/api/auth/mode', { credentials: 'omit', cache: 'no-store' })
          const latestMode = await latest.json()
          assertMode(latestMode)
          if (latestMode.phase === 'SSO_ONLY') {
            window.location.assign('/')
            return
          }
          const next = await api<SetupContext>('/api/sso-setup/context')
          updateContext(next, { preserveRows: true })
          setError('接入状态已发生变化，已重新读取。请重新确认当前账号关联并完成接入。')
        } catch {
          setError('接入状态已发生变化，请刷新页面读取最新进度。')
        }
      }
    },
    [api, updateContext]
  )

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return
      setBusy(true)
      setError('')
      setNotice('')
      try {
        await action()
      } catch (caught) {
        await handleError(caught)
      } finally {
        setBusy(false)
      }
    },
    [busy, handleError]
  )

  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current || phase !== 'sso' || !mode) return
    loadedRef.current = true
    void run(async () => {
      if (mode.phase === 'SSO_ONLY') {
        await refreshUser()
        return
      }
      const next = await api<SetupContext>('/api/sso-setup/context')
      updateContext(next)
      await suggestPhone(next)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode])

  const pairs = (context?.users ?? []).map((local, index) => ({ local, row: rows[index], index }))
  const linked = pairs.filter(({ local }) => local.sso_user_id !== null)
  const review = pairs.filter(({ local }) => local.sso_user_id === null)
    .sort((a, b) => Number(a.row?.sso_user_id != null) - Number(b.row?.sso_user_id != null))
  const remaining = review.filter(({ row }) => row?.sso_user_id == null).length
  const recommended = review.filter(({ row }) => row?.sso_user_id != null && row.selection_source === 'phone').length
  const chosen = review.length - remaining - recommended
  const people = new Map((context?.roster ?? []).map(person => [person.user_id, person]))
  const personLabel = (person: SetupContext['roster'][number]) => [person.name, person.department, person.username].filter(Boolean).join(' · ')
  const mappingIssue = context ? validateMapping(context, rows) : '请先使用应用负责人账号登录'
  const step = !context ? 0 : context.phase === 'SSO_ONLY' ? 3 : context.phase === 'ADMIN_VERIFICATION_REQUIRED' ? 2 : 1

  const connect = () => window.location.assign('/sso-setup?connect=1')

  const refresh = () =>
    void run(async () => {
      const next = await api<SetupContext>('/api/sso-setup/context')
      updateContext(next, { preserveRows: true })
      await suggestPhone(next)
    })

  const suggestPhone = async (current: SetupContext) => {
    if (current.phase !== 'MAPPING_REQUIRED' || current.users.every(local => local.sso_user_id !== null)) return
    const revision = current.revision
    try {
      const result = await api<PhoneSuggestions>('/api/sso-setup/match-phone', {
        method: 'POST',
        body: { revision },
      })
      if (result.available !== true) {
        setSuggestionMessage(result.message || '手机号推荐暂不可用，您可以手动选择人员并保存草稿。')
        return
      }
      if (result.revision !== revision || !Array.isArray(result.suggestions)) {
        throw new ApiError(409, 'REVISION_CONFLICT', '推荐所依据的账号已变化，请刷新', 'sso')
      }
      setRows((currentRows) => {
        const nextRows = currentRows.map((row) => ({ ...row }))
        applySuggestions(current, nextRows, result)
        return nextRows
      })
      setSuggestionMessage('')
    } catch (caught) {
      if (caught instanceof ApiError && [404, 429, 503].includes(caught.status)) {
        setSuggestionMessage('手机号推荐暂不可用，您可以手动选择人员并保存草稿。')
      } else throw caught
    }
  }

  const saveDraft = () =>
    void run(async () => {
      if (!context) throw new Error('请先使用应用负责人账号登录')
      const next = await api<SetupContext>('/api/sso-setup/draft', {
        method: 'POST',
        body: { revision: context.revision, rows: draftRows(rows) },
      })
      updateContext(next, { roster: context.roster })
      setNotice('进度已保存，下次打开向导可以继续。原登录仍可用。')
    })

  const saveMapping = () =>
    void run(async () => {
      if (!context) throw new Error('请先使用应用负责人账号登录')
      if (rows.some((row) => row.sso_user_id === null) && !allowUnmapped) {
        throw new Error('请先确认留空账号保留数据，切换后不能使用旧登录')
      }
      const next = await api<SetupContext>('/api/sso-setup/mapping', {
        method: 'POST',
        body: {
          revision: context.revision,
          allow_unmapped: allowUnmapped,
          rows: draftRows(rows).map((row) => ({ ...row, confirmed: true })),
        },
      })
      updateContext(next)
      setNotice('账号对应关系已保存。原登录可用，请核对切换预览。')
    })

  const complete = () =>
    void run(async () => {
      if (context?.phase !== 'ADMIN_VERIFICATION_REQUIRED') throw new Error('请先确认账号关联')
      const next = await api<SetupContext>('/api/sso-setup/complete', {
        method: 'POST',
        body: { revision: context.revision },
      })
      updateContext(next)
      if (next.phase !== 'SSO_ONLY') throw new Error('后台尚未完成切换，请刷新状态')
      window.location.assign('/')
    })

  const rollback = () =>
    void run(async () => {
      setConfirmRollback(false)
      if (!context?.rollback_available) {
        throw new Error('当前阶段不能撤销历史关联，请由负责人完成接入；需要维护恢复时请联系维护者。')
      }
      const next = await api<SetupContext>('/api/sso-setup/rollback', {
        method: 'POST',
        body: { revision: context.revision },
      })
      updateContext(next)
      setNotice('已撤销本次关联，原账号、原角色和业务数据保留。可以继续使用原登录。')
    })

  const changePerson = (index: number, value: string) => {
    setAllowUnmapped(false)
    setRows((currentRows) =>
      currentRows.map((row, i) =>
        i === index
          ? {
              ...row,
              sso_user_id: value ? Number(value) : null,
              selection_source: 'manual' as const,
              edited: true,
              saved: false,
              issue: '',
            }
          : row
      )
    )
  }

  if (phase !== 'sso') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>
        <div className="text-sm" style={{ color: 'var(--color-muted)' }}>正在进入接入向导…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <header className="border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between h-14 px-6">
          <Link href="/" className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
            AI 图片审核 · 应用接入
          </Link>
          <span
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
          >
            {mode?.maintenance_locked
              ? '维护处理中'
              : mode?.legacy_login_enabled
                ? '原登录可用'
                : '已连接佳选'}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10" aria-busy={busy}>
        {mode?.phase === 'SSO_ONLY' ? (
          <section className="p-8 rounded-xl text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--color-accent)' }} />
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-fg)' }}>已完成接入</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
              {mode.classification === 'GREENFIELD' ? '应用已启用公司账号登录，可以直接进入。' : '应用已启用公司账号登录，原账号关联和历史记录已保留。'}
            </p>
            {user && (
              <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
                当前身份：{user.name}（{user.role === 'PENDING' ? '待授权' : user.role}）
              </p>
            )}
            <Link
              href="/"
              className="inline-block mt-6 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'oklch(58% 0.18 255)' }}
            >
              返回应用
            </Link>
          </section>
        ) : (
          <>
            <div className="mb-6">
              <p className="text-xs font-medium tracking-wider uppercase" style={{ color: 'var(--color-muted)' }}>
                {mode?.app_id}
              </p>
              <h1 className="mt-1 text-2xl font-semibold" style={{ color: 'var(--color-fg)' }}>将图片审核接入公司账号</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
                确认账号对应关系，保留原有角色和历史数据。
              </p>
            </div>

            <ol className="flex items-center gap-2 mb-6 text-xs" aria-label="接入进度">
              {['负责人登录', '核对旧账号', '切换登录'].map((label, index) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                  style={{
                    background: step === index ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                    color: step === index ? 'var(--color-accent)' : 'var(--color-muted)',
                    border: '1px solid var(--color-border)',
                    fontWeight: step === index ? 600 : 400,
                  }}
                  aria-current={step === index ? 'step' : undefined}
                >
                  <span>{index + 1}</span> {label}
                </li>
              ))}
            </ol>

            {error && (
              <div className="mb-4 px-4 py-2.5 rounded-lg text-sm" role="alert" style={{ background: 'var(--color-danger-subtle)', color: 'var(--color-danger)' }}>
                {error}
              </div>
            )}
            {notice && (
              <div className="mb-4 px-4 py-2.5 rounded-lg text-sm" role="status" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                {notice}
              </div>
            )}

            <section className="p-6 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {!context ? (
                <div className="text-center py-8">
                  <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>请使用本应用负责人的公司账号登录。</p>
                  <button
                    onClick={connect}
                    disabled={busy}
                    className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
                    style={{ background: 'oklch(58% 0.18 255)', opacity: busy ? 0.6 : 1 }}
                  >
                    重新登录负责人账号
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
                      {context.phase === 'MAPPING_REQUIRED' ? '这些旧账号的历史记录属于谁？' : '切换预览'}
                    </h2>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={refresh}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {context.connected_user_id ? '刷新人员名单' : '刷新接入状态'}
                      </button>
                    </div>
                  </div>

                  {!context.roster.length ? (
                    <div className="px-4 py-3 rounded-lg mb-4 text-sm" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                      <p style={{ color: 'var(--color-fg)' }}>刷新人员名单后继续操作；接入操作均需验证负责人的公司账号。</p>
                      <button onClick={connect} disabled={busy} className="mt-2 text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
                        连接佳选账号
                      </button>
                    </div>
                  ) : (
                    <p className="mb-4 text-sm" style={{ color: 'var(--color-muted)' }}>
                      当前负责人账号 {people.get(context.current_sso_user_id ?? context.connected_user_id ?? 0)?.username || `#${context.current_sso_user_id ?? context.connected_user_id}`}
                    </p>
                  )}

                  {context.phase === 'MAPPING_REQUIRED' ? (
                    <p className="mb-4 text-sm" role="status">
                      共 {pairs.length} 个旧账号，{linked.length} 个已有绑定，{recommended} 个推荐待核对，{remaining} 个还需选择
                      {chosen > 0 ? `，${chosen} 个手动选择待确认` : ''}。
                    </p>
                  ) : (
                    <p className="mb-4 text-sm" role="status">
                      已关联 {linked.length} 个旧账号，{review.length} 个暂不关联。
                      切换后旧登录将关闭。暂未关联账号的历史记录仍保留。
                    </p>
                  )}

                  {review.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left" style={{ borderColor: 'var(--color-border)' }}>
                            <th scope="col" className="py-2 pr-4">旧账号</th>
                            <th scope="col" className="py-2 pr-4">原有角色</th>
                            <th scope="col" className="py-2">对应的公司账号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.map(({ local, row, index }) => {
                            const issue = row ? rowIssue(context, row) : ''
                            return (
                              <tr key={local.local_user_id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                                <td className="py-3 pr-4">
                                  <strong>{local.name || local.username}</strong>
                                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                                    {[local.department, local.username].filter(Boolean).join(' · ')}
                                  </div>
                                </td>
                                <td className="py-3 pr-4">{local.roles.join('、') || '尚无角色'}</td>
                                <td className="py-3">
                                  {context.phase === 'MAPPING_REQUIRED' ? (
                                    <>
                                      <select
                                        aria-label={`${local.username} 对应的公司账号`}
                                        value={row?.sso_user_id ?? ''}
                                        disabled={busy}
                                        onChange={(event) => changePerson(index, event.target.value)}
                                        className="w-full px-2.5 py-1.5 rounded-lg text-sm"
                                        style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                                      >
                                        <option value="">请选择，也可暂时留空</option>
                                        {row?.sso_user_id != null && !people.has(row.sso_user_id) && (
                                          <option disabled value={row.sso_user_id}>原选择 #{row.sso_user_id} · 不在当前名单</option>
                                        )}
                                        {context.roster.map(person => (
                                          <option key={person.user_id} value={person.user_id} disabled={person.status !== 1}>
                                            {personLabel(person)}{person.status !== 1 ? ' · 已停用' : ''}
                                          </option>
                                        ))}
                                      </select>
                                      <div className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                                        {row?.saved && '已保存草稿 · '}
                                        {row?.sso_user_id == null ? <a href="#missing-member-help">找不到这位同事？</a>
                                          : row.selection_source === 'phone' ? '手机号推荐，请核对' : '手动选择'}
                                      </div>
                                      {issue && <div className="text-xs" role="status" style={{ color: 'var(--color-danger)' }}>{issue}</div>}
                                    </>
                                  ) : '暂不关联'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {linked.length > 0 && (
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer">查看已关联的 {linked.length} 个旧账号</summary>
                      <ul className="mt-2 space-y-2">
                        {linked.map(({ local, row }) => {
                          const person = people.get(local.sso_user_id!)
                          return (
                            <li key={local.local_user_id}>
                              {local.name || local.username} → {person ? personLabel(person) : `公司账号 #${local.sso_user_id}`}
                              {row && rowIssue(context, row) && <span className="ml-2" style={{ color: 'var(--color-danger)' }}>{rowIssue(context, row)}</span>}
                            </li>
                          )
                        })}
                      </ul>
                    </details>
                  )}

                  {suggestionMessage && (
                    <p className="mt-3 text-sm" role="status" style={{ color: 'var(--color-muted)' }}>
                      {suggestionMessage}
                    </p>
                  )}
                  {context.phase === 'MAPPING_REQUIRED' && (
                    <p id="missing-member-help" className="mt-3 text-sm" style={{ color: 'var(--color-muted)' }}>
                      找不到同事时，在应用中心的“管理访问成员”中补应用权限，再刷新人员名单。也可以保存进度，稍后继续。
                    </p>
                  )}

                  {context.phase === 'MAPPING_REQUIRED' && remaining > 0 && (
                    <label className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg cursor-pointer" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                      <input
                        type="checkbox"
                        checked={allowUnmapped}
                        disabled={busy}
                        onChange={(event) => setAllowUnmapped(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span className="text-sm" style={{ color: 'var(--color-fg)' }}>
                        确认 {remaining} 个留空账号暂不关联，保留数据，切换后停用旧登录
                      </span>
                    </label>
                  )}

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {context.phase === 'MAPPING_REQUIRED' && (
                      <>
                        <button
                          onClick={saveDraft}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                          style={{ border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
                        >
                          <Save className="w-4 h-4" />
                          保存进度
                        </button>
                        <button
                          onClick={saveMapping}
                          disabled={busy || !!mappingIssue || !context.connected_user_id || (remaining > 0 && !allowUnmapped)}
                          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold text-white"
                          style={{ background: 'oklch(58% 0.18 255)', opacity: busy ? 0.6 : 1 }}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {busy ? '正在处理…' : '确认账号对应关系'}
                        </button>
                        {remaining > 0 && (
                          <span className="text-sm" role="status" style={{ color: 'var(--color-muted)' }}>
                            {allowUnmapped ? `已选择将 ${remaining} 个账号暂不关联。` : '请为剩余账号选择同事，或勾选“暂不关联”后继续。'}
                          </span>
                        )}
                      </>
                    )}
                    {context.phase === 'ADMIN_VERIFICATION_REQUIRED' && (
                      <button
                        onClick={complete}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold text-white"
                        style={{ background: 'oklch(58% 0.18 255)', opacity: busy ? 0.6 : 1 }}
                      >
                        <LogOut className="w-4 h-4" />
                        切换为公司账号登录
                      </button>
                    )}
                  </div>
                  {mappingIssue && context.phase === 'MAPPING_REQUIRED' && (
                    <p className="mt-2 text-sm" role="status" style={{ color: 'var(--color-danger)' }}>
                      {mappingIssue}
                    </p>
                  )}

                  {context.rollback_available && (
                    <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
                      {confirmRollback ? (
                        <div>
                          <p className="text-sm mb-3" style={{ color: 'var(--color-fg)' }}>
                            撤销本批次账号关联并恢复原登录，保留原用户、角色和业务数据。
                          </p>
                          <div className="flex gap-3">
                            <button
                              onClick={rollback}
                              disabled={busy}
                              className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                              style={{ background: 'var(--color-danger)' }}
                            >
                              确认撤销本次关联
                            </button>
                            <button
                              onClick={() => setConfirmRollback(false)}
                              className="px-4 py-2 rounded-lg text-sm font-medium"
                              style={{ border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
                            >
                              继续接入
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRollback(true)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 text-sm font-medium"
                          style={{ color: 'var(--color-danger)' }}
                        >
                          <Undo2 className="w-4 h-4" />
                          撤销本次关联，继续使用原登录
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            <div className="mt-6 text-center">
              <Link href="/" className="text-sm" style={{ color: 'var(--color-muted)' }}>
                返回原应用
              </Link>
            </div>
          </>
        )}
      </main>
      <footer className="max-w-4xl mx-auto px-6 pb-10 text-center text-xs" style={{ color: 'var(--color-muted)' }}>
        账号归属由应用负责人确认，业务角色继续由原应用管理。
      </footer>
    </div>
  )
}
