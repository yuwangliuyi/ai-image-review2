'use client';

import { useEffect, useState, useCallback } from 'react';
import AuthLayout from '@/components/AuthLayout';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Image,
  Clock,
  CheckCircle2,
  Archive,
  Upload,
  Package,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

/* ─── 直接用 oklch 值 — SVG 里 CSS 变量不解析 ─── */
const COLORS = {
  accent: 'oklch(58% 0.18 255)',
  accentLight: 'oklch(80% 0.08 240)',
  success: 'oklch(66% 0.16 160)',
  successLight: 'oklch(90% 0.08 160)',
  danger: 'oklch(56% 0.18 25)',
  dangerLight: 'oklch(90% 0.05 25)',
  warn: 'oklch(70% 0.15 80)',
  warnLight: 'oklch(93% 0.1 80)',
  fg: 'oklch(18% 0.012 250)',
  muted: 'oklch(54% 0.012 250)',
  border: 'oklch(92% 0.005 250)',
  surface: 'oklch(100% 0 0)',
  bg: 'oklch(99% 0.002 240)',
};

const PIE_COLORS = [COLORS.success, COLORS.danger, COLORS.warn];

/* ─── 卡片调色盘 ─── */
const cardPalettes = [
  { accent: COLORS.accent, light: 'oklch(58% 0.18 255 / 0.08)', icon: Upload, label: '今日上传' },
  { accent: COLORS.warn, light: 'oklch(70% 0.15 80 / 0.1)', icon: Clock, label: '待审核' },
  { accent: COLORS.success, light: 'oklch(66% 0.16 160 / 0.08)', icon: TrendingUp, label: '本周通过率' },
  { accent: 'oklch(52% 0.14 290)', light: 'oklch(52% 0.14 290 / 0.06)', icon: Archive, label: '归档总数' },
];

/* ─── 状态标签 ─── */
const statusBadge: Record<string, { bg: string; fg: string; label: string }> = {
  APPROVED:  { bg: 'oklch(66% 0.16 160 / 0.08)', fg: 'oklch(45% 0.15 155)', label: '已通过' },
  REJECTED:  { bg: 'oklch(56% 0.18 25 / 0.06)',  fg: 'oklch(45% 0.16 25)',  label: '已驳回' },
  PENDING:   { bg: 'oklch(70% 0.15 80 / 0.08)',  fg: 'oklch(50% 0.14 75)',  label: '审核中' },
  ARCHIVED:  { bg: 'oklch(60% 0.04 250 / 0.06)', fg: 'oklch(40% 0.04 250)', label: '已归档' },
};

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dimension, setDimension] = useState<'overall' | 'department' | 'personal'>('overall');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('dimension', dimension);
      if (dimension === 'department' && selectedDepartment) {
        params.set('department', selectedDepartment);
      }
      const res = await fetch(`/api/stats?${params}`);
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [dimension, selectedDepartment]);

  useEffect(() => {
    fetchStats();
    const i = setInterval(fetchStats, 30000);
    return () => clearInterval(i);
  }, [fetchStats]);

  /* ─── Loading 骨架 ─── */
  if (loading) {
    return (
      <AuthLayout title="仪表盘">
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-[136px] rounded-[var(--radius-card)]"
                style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 h-[340px] rounded-[var(--radius-card)]" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} />
            <div className="lg:col-span-2 h-[340px] rounded-[var(--radius-card)]" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }} />
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (!stats) {
    return (
      <AuthLayout title="仪表盘">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Package className="w-12 h-12" style={{ color: COLORS.muted, opacity: 0.4 }} />
          <p style={{ color: COLORS.muted }}>加载统计数据失败</p>
        </div>
      </AuthLayout>
    );
  }

  const todayUploads =
    stats.dailyData?.length > 0 ? stats.dailyData[stats.dailyData.length - 1].count : 0;

  const pieData = [
    { name: '已通过', value: stats.approvedCount },
    { name: '已驳回', value: stats.rejectedCount },
    { name: '待审核', value: stats.pendingCount },
  ].filter((d) => d.value > 0);

  const totalReviewed = pieData.reduce((s, d) => s + d.value, 0);

  const sortedReviewers = [...(stats.reviewers || [])].sort(
    (a: any, b: any) => b.total - a.total
  );

  const recentSpus = stats.recentReviews
    ?.filter((r: any, i: number, arr: any[]) => {
      return arr.findIndex((x: any) => x.image?.spu?.name === r.image?.spu?.name) === i;
    })
    .slice(0, 5);

  const categoryData = stats.categoryDistribution || [];
  const rejectionList = stats.rejectionReasons || [];

  /* ─── KPI 数据映射 ─── */
  const kpiCards = [
    {
      palette: cardPalettes[0],
      value: todayUploads,
      suffix: '',
      delta: todayUploads > 0 ? `+${todayUploads}` : undefined,
      deltaGood: true,
    },
    {
      palette: cardPalettes[1],
      value: stats.pendingCount,
      suffix: '',
      delta: undefined,
    },
    {
      palette: cardPalettes[2],
      value: stats.approvalRate,
      suffix: '%',
      delta: stats.approvalRate > 0 ? `${stats.approvalRate}%` : undefined,
      deltaGood: true,
    },
    {
      palette: cardPalettes[3],
      value: stats.totalArchived,
      suffix: '',
      delta: undefined,
    },
  ];

  return (
    <AuthLayout title="仪表盘">
      {/* ===== 维度切换器 ===== */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div
          className="inline-flex rounded-[var(--radius-nav)] p-1 gap-0.5"
          style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
        >
          {(['overall', 'department', 'personal'] as const).map((d) => {
            const labels: Record<string, string> = { overall: '总数据', department: '部门', personal: '个人' };
            const active = dimension === d;
            return (
              <button
                key={d}
                onClick={() => setDimension(d)}
                className="px-4 py-1.5 text-sm font-medium rounded-[calc(var(--radius-nav)-2px)] transition-all duration-150"
                style={{
                  background: active ? COLORS.surface : 'transparent',
                  color: active ? COLORS.accent : COLORS.muted,
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {labels[d]}
              </button>
            );
          })}
        </div>

        {/* 部门选择器（仅部门维度 + ADMIN 可见） */}
        {dimension === 'department' && stats?.currentUser?.role === 'ADMIN' && (
          <select
            value={selectedDepartment || stats?.currentUser?.department || ''}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-[var(--radius-nav)] outline-none"
            style={{
              background: COLORS.surface,
              color: COLORS.fg,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            {(stats?.departments || []).map((d: any) => (
              <option key={d.department} value={d.department}>
                {d.department}
              </option>
            ))}
          </select>
        )}

        {/* 维度标签 */}
        {dimension !== 'overall' && (
          <span
            className="text-xs px-2.5 py-1 rounded-[var(--radius-pill)] font-medium"
            style={{ background: 'oklch(58% 0.18 255 / 0.06)', color: COLORS.accent }}
          >
            {dimension === 'department'
              ? `📁 ${stats?.currentDepartment || stats?.currentUser?.department || ''}`
              : '👤 个人视角'}
          </span>
        )}
      </div>

      {/* ===== KPI 卡片行 ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpiCards.map((card, i) => (
          <StatCard key={i} {...card} />
        ))}
      </div>

      {/* ===== 图表行 (60/40) ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-6">
        {/* 近7日上传量 */}
        <ChartCard className="lg:col-span-3" title="近 7 日上传量" subtitle="每日上传 SPU 数量">
          {stats.dailyData?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.dailyData} barGap={6} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0.25} />
                  </linearGradient>
                  <linearGradient id="barGradientHover" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={1} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.border} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: COLORS.muted }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={false}
                  tickLine={false}
                  dy={8}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: COLORS.muted }}
                  axisLine={false}
                  tickLine={false}
                  dx={-4}
                />
                <Tooltip
                  cursor={{ fill: 'oklch(58% 0.18 255 / 0.04)' }}
                  contentStyle={{
                    borderRadius: '10px',
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.surface,
                    fontSize: '13px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                    padding: '8px 14px',
                  }}
                  labelFormatter={(v) => `📅 ${v}`}
                  formatter={(value: any) => [`${value} 个 SPU`, '上传量']}
                />
                <Bar
                  dataKey="count"
                  fill="url(#barGradient)"
                  radius={[5, 5, 2, 2]}
                  maxBarSize={48}
                  name="上传量"
                  onMouseEnter={(data, index) => {
                    // Recharts handles bar hover via activeBar
                  }}
                  activeBar={{
                    fill: 'url(#barGradientHover)',
                    radius: [5, 5, 2, 2] as any,
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={Image} text="暂无上传数据" />
          )}
        </ChartCard>

        {/* 审核结果分布 */}
        <ChartCard className="lg:col-span-2" title="审核结果分布" subtitle="审核完成情况">
          {pieData.length > 0 ? (
            <div className="relative">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                    cornerRadius={3}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: '10px',
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.surface,
                      fontSize: '13px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                      padding: '8px 14px',
                    }}
                    formatter={(value: any, name: any) => [`${value} 个`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* 中心标签 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: '46%', transform: 'translateY(-50%)' }}>
                <span className="text-[26px] font-semibold tracking-tight" style={{ color: COLORS.fg }}>
                  {totalReviewed}
                </span>
                <span className="text-[11px]" style={{ color: COLORS.muted }}>总审核数</span>
              </div>
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} text="暂无审核数据" />
          )}

          {/* 图例 */}
          {pieData.length > 0 && (
            <div className="flex items-center justify-center gap-5 mt-3">
              {pieData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs" style={{ color: COLORS.muted }}>
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  {d.name}
                  <span className="font-semibold" style={{ color: COLORS.fg }}>{d.value}</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* ===== 底部行 ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {/* 审核员排行 */}
        <ChartCard title="审核员排行" subtitle="按审核量降序">
          {sortedReviewers.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <th className="text-left py-3 pr-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: COLORS.muted }}>
                    #
                  </th>
                  <th className="text-left py-3 pr-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: COLORS.muted }}>
                    姓名
                  </th>
                  <th className="text-right py-3 pr-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: COLORS.muted }}>
                    审核量
                  </th>
                  <th className="text-right py-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: COLORS.muted }}>
                    通过率
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedReviewers.map((r: any, i: number) => {
                  const rate = parseFloat(r.approvalRate);
                  const rateColor =
                    rate >= 80 ? COLORS.success
                    : rate >= 50 ? COLORS.warn
                    : COLORS.danger;
                  return (
                    <tr
                      key={r.id}
                      className="transition-colors hover:bg-[oklch(58%_0.18_255/0.03)]"
                      style={{ borderBottom: i < sortedReviewers.length - 1 ? `1px solid ${COLORS.bg}` : 'none' }}
                    >
                      <td className="py-3 pr-2">
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold"
                          style={{
                            background: i === 0 ? 'oklch(58% 0.18 255 / 0.1)' : 'transparent',
                            color: i === 0 ? COLORS.accent : COLORS.muted,
                          }}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="py-3 pr-2 font-medium" style={{ color: COLORS.fg }}>
                        {r.name}
                      </td>
                      <td className="py-3 pr-2 text-right tabular-nums font-semibold" style={{ color: COLORS.fg }}>
                        {r.total}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        <span
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: rateColor }}
                        >
                          {rate >= 80 && <TrendingUp className="w-3 h-3" />}
                          {r.approvalRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={CheckCircle2} text="暂无审核记录" />
          )}
        </ChartCard>

        {/* 最近上传 */}
        <ChartCard title="最近上传" subtitle="最新提交的 SPU">
          {recentSpus?.length > 0 ? (
            <div className="space-y-1">
              {recentSpus.map((r: any) => {
                const spu = r.image?.spu;
                const st = statusBadge[r.action] || statusBadge.PENDING;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between py-3 px-2 -mx-2 rounded-[var(--radius-nav)] transition-colors hover:bg-[oklch(58%_0.18_255/0.03)]"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
                        style={{ background: 'oklch(58% 0.18 255 / 0.06)' }}
                      >
                        <Package className="w-4 h-4" style={{ color: COLORS.accent }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: COLORS.fg }}>
                          {spu?.name || '未知'}
                        </p>
                        <p className="text-[11px]" style={{ color: COLORS.muted }}>
                          {r.reviewer?.name || '—'}
                        </p>
                      </div>
                    </div>
                    <span
                      className="flex-shrink-0 ml-3 px-2.5 py-1 rounded-[var(--radius-pill)] text-[11px] font-semibold"
                      style={{ background: st.bg, color: st.fg }}
                    >
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Upload} text="暂无上传记录" />
          )}
        </ChartCard>

        {/* 品类分布 */}
        <ChartCard title="品类分布" subtitle="各品类 SPU 数量与通过率">
          {categoryData.length > 0 ? (
            <div className="space-y-1.5">
              {categoryData.map((c: any) => {
                const maxCount = Math.max(...categoryData.map((x: any) => x.count));
                const barW = maxCount > 0 ? (c.count / maxCount) * 100 : 0;
                const rate = parseFloat(c.approvalRate);
                return (
                  <div key={c.category} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium" style={{ color: COLORS.fg }}>{c.category}</span>
                      <span className="text-[11px] tabular-nums" style={{ color: COLORS.muted }}>
                        {c.count} SPU · {c.approvalRate}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'oklch(92% 0.005 250)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${barW}%`,
                          background: rate >= 80 ? COLORS.success : rate >= 50 ? COLORS.warn : COLORS.danger,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Package} text="暂无品类数据" />
          )}
        </ChartCard>
      </div>

      {/* ===== 驳回原因分析 ===== */}
      {rejectionList.length > 0 && (
        <div className="mb-6">
          <ChartCard title="驳回原因分析" subtitle={`最近 ${rejectionList.length} 条驳回记录`}>
            <div className="space-y-1">
              {rejectionList.map((r: any, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-[var(--radius-nav)] transition-colors hover:bg-[oklch(56%_0.18_25/0.03)]"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold"
                    style={{ background: 'oklch(56% 0.18 25 / 0.08)', color: COLORS.danger }}
                  >
                    !
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium" style={{ color: COLORS.fg }}>
                      {r.image?.spu?.name || '未知SPU'}
                      <span className="font-normal ml-1.5 text-[11px]" style={{ color: COLORS.muted }}>
                        {r.image?.filename || ''}
                      </span>
                    </p>
                    <p className="text-[12px] mt-0.5" style={{ color: COLORS.danger }}>
                      {r.comment}
                    </p>
                  </div>
                  <span className="text-[11px] flex-shrink-0" style={{ color: COLORS.muted }}>
                    {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      )}

    </AuthLayout>
  );
}

/* ═══════════════════════════════════════════════
   Stat Card
   ═══════════════════════════════════════════════ */
function StatCard({
  palette,
  value,
  suffix = '',
  delta,
  deltaGood,
}: {
  palette: typeof cardPalettes[0];
  value: number | string;
  suffix?: string;
  delta?: string;
  deltaGood?: boolean;
}) {
  const { accent, light, icon: Icon, label } = palette;

  return (
    <div
      className="group p-5 rounded-[var(--radius-card)] transition-all duration-200 hover:-translate-y-[2px] relative overflow-hidden"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* 顶部色条 */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[var(--radius-card)] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: accent }}
      />

      <div className="flex items-center gap-3 mb-3 relative z-10">
        <div
          className="p-2.5 rounded-[12px] transition-colors duration-200"
          style={{ background: light }}
        >
          <Icon className="w-[18px] h-[18px]" style={{ color: accent }} />
        </div>
        <p className="text-[13px] font-medium" style={{ color: COLORS.muted }}>
          {label}
        </p>
      </div>

      <p className="text-[30px] font-bold tracking-tight leading-none mb-1 relative z-10" style={{ color: COLORS.fg }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix}
      </p>

      {delta !== undefined ? (
        <div className="flex items-center gap-1 text-xs font-semibold relative z-10">
          {deltaGood ? (
            <TrendingUp className="w-3.5 h-3.5" style={{ color: COLORS.success }} />
          ) : (
            <TrendingDown className="w-3.5 h-3.5" style={{ color: COLORS.danger }} />
          )}
          <span style={{ color: deltaGood ? COLORS.success : COLORS.danger }}>
            {delta}
          </span>
          <span className="font-normal" style={{ color: COLORS.muted }}>较昨日</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs relative z-10" style={{ color: COLORS.muted }}>
          <Minus className="w-3.5 h-3.5" />
          <span className="font-normal">暂无变化</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Chart Card
   ═══════════════════════════════════════════════ */
function ChartCard({
  children,
  className = '',
  title,
  subtitle,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      className={`p-6 rounded-[var(--radius-card)] ${className}`}
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div className="mb-5">
        <h3 className="text-[15px] font-semibold" style={{ color: COLORS.fg }}>
          {title}
        </h3>
        {subtitle && (
          <p className="text-[12px] mt-0.5" style={{ color: COLORS.muted }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Empty State
   ═══════════════════════════════════════════════ */
function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="h-[260px] flex flex-col items-center justify-center gap-2.5">
      <div
        className="p-3 rounded-full"
        style={{ background: 'oklch(58% 0.18 255 / 0.04)' }}
      >
        <Icon className="w-6 h-6" style={{ color: COLORS.muted, opacity: 0.5 }} />
      </div>
      <span className="text-[13px]" style={{ color: COLORS.muted }}>
        {text}
      </span>
    </div>
  );
}
