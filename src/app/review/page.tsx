'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AuthLayout from '@/components/AuthLayout';
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  MessageSquare,
  Image,
  X,
  Maximize2,
  Clock,
  Package,
  ChevronLeft,
  ChevronRight,
  User,
  FolderOpen,
} from 'lucide-react';

interface ReviewImage {
  id: string;
  filename: string;
  storedPath: string;
  fileSize: number;
  status: string;
  spuId: string;
  spu: { id: string; name: string; category?: string; assignedReviewer?: { name: string } };
  uploadedBy: { name: string; department: string };
  reviews: {
    id: string;
    action: string;
    comment: string | null;
    createdAt: string;
    reviewer: { name: string };
  }[];
  createdAt: string;
}

/* ─── 直接 oklch ─── */
const C = {
  accent:       'oklch(58% 0.18 255)',
  accentHover:  'oklch(50% 0.18 255)',
  accentLight:  'oklch(58% 0.18 255 / 0.06)',
  success:      'oklch(66% 0.16 160)',
  successHover: 'oklch(58% 0.16 160)',
  successLight: 'oklch(66% 0.16 160 / 0.08)',
  successFg:    'oklch(45% 0.15 155)',
  danger:       'oklch(56% 0.18 25)',
  dangerHover:  'oklch(48% 0.18 25)',
  dangerLight:  'oklch(56% 0.18 25 / 0.06)',
  dangerFg:     'oklch(45% 0.16 25)',
  warn:         'oklch(70% 0.15 80)',
  warnLight:    'oklch(70% 0.15 80 / 0.08)',
  warnFg:       'oklch(50% 0.14 75)',
  fg:           'oklch(18% 0.012 250)',
  muted:        'oklch(54% 0.012 250)',
  border:       'oklch(92% 0.005 250)',
  surface:      'oklch(100% 0 0)',
  bg:           'oklch(99% 0.002 240)',
};

const statusBadgeDef: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING:   { bg: C.warnLight,  fg: C.warnFg,  label: '待审核' },
  APPROVED:  { bg: C.successLight, fg: C.successFg, label: '已通过' },
  REJECTED:  { bg: C.dangerLight, fg: C.dangerFg, label: '已驳回' },
};

function StatusBadge({ status }: { status: string }) {
  const def = statusBadgeDef[status] || statusBadgeDef.PENDING;
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold gap-1.5"
      style={{ background: def.bg, color: def.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: def.fg }} />
      {def.label}
    </span>
  );
}

export default function ReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const userRole = (session?.user as any)?.role;

  // 角色守卫：仅 REVIEWER 和 ADMIN 可访问审核中心
  useEffect(() => {
    if (status === 'authenticated' && userRole === 'UPLOADER') {
      router.replace('/dashboard');
    }
  }, [status, userRole, router]);

  const [images, setImages] = useState<ReviewImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('PENDING');
  const [message, setMessage] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);

  /* 筛选后的图片列表 */
  const filteredImages = filter === 'ALL'
    ? images
    : images.filter((img) => img.status === filter);

  const currentImage = filteredImages[currentIdx] || null;

  const counts = {
    ALL: images.length,
    PENDING: images.filter((i) => i.status === 'PENDING').length,
    APPROVED: images.filter((i) => i.status === 'APPROVED').length,
    REJECTED: images.filter((i) => i.status === 'REJECTED').length,
  };

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/spus?limit=50');
      const data = await res.json();
      if (!data.spus) return;

      const allImages: ReviewImage[] = [];
      for (const spu of data.spus) {
        const imgRes = await fetch(`/api/spus/${spu.id}/upload`);
        const imgData = await imgRes.json();
        if (Array.isArray(imgData)) {
          allImages.push(
            ...imgData.map((img: any) => ({
              ...img,
              spu: { id: spu.id, name: spu.name, category: spu.category, assignedReviewer: spu.assignedReviewer },
              uploadedBy: spu.uploadedBy,
            }))
          );
        }
      }
      setImages(allImages);
    } catch (err) {
      console.error('Fetch error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  /* 切换筛选时重置当前 index */
  useEffect(() => {
    setCurrentIdx(0);
    setComment('');
  }, [filter]);

  /* ─── 审核操作 ─── */
  const doReview = useCallback(async (action: 'APPROVED' | 'REJECTED') => {
    if (!currentImage || reviewingId) return;
    setReviewingId(currentImage.id);
    setMessage('');
    try {
      const res = await fetch(`/api/images/${currentImage.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: comment.trim() || undefined }),
      });
      if (res.ok) {
        const label = action === 'APPROVED' ? '已通过 ✓' : '已驳回 ✗';
        setMessage(label);
        setComment('');

        // 更新本地状态
        setImages((prev) =>
          prev.map((img) =>
            img.id === currentImage.id ? { ...img, status: action } : img
          )
        );

        // 自动跳到下一张
        setTimeout(() => {
          setMessage('');
          const remaining = filteredImages.filter((img) => img.id !== currentImage.id);
          const newIdx = Math.min(currentIdx, remaining.length - 1);
          if (remaining.length > 0 && remaining[currentIdx]?.status === filter) {
            // stay at same index if possible
          } else {
            setCurrentIdx(newIdx);
          }
        }, 500);
      } else {
        const data = await res.json();
        setMessage(data.error || '审核失败');
      }
    } catch {
      setMessage('审核失败，请重试');
    }
    setReviewingId(null);
  }, [currentImage, reviewingId, comment, filter, filteredImages, currentIdx]);

  const handleSkip = useCallback(() => {
    if (currentIdx < filteredImages.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setComment('');
      setMessage('');
    }
  }, [currentIdx, filteredImages.length]);

  /* ─── 键盘快捷键 ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (lightboxOpen) {
        if (e.key === 'Escape') setLightboxOpen(false);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          if (currentImage?.status === 'PENDING') doReview('APPROVED');
          break;
        case 'r':
          e.preventDefault();
          if (currentImage?.status === 'PENDING') doReview('REJECTED');
          break;
        case 's':
          e.preventDefault();
          if (currentImage?.status === 'PENDING') handleSkip();
          break;
        case 'arrowleft':
          e.preventDefault();
          if (currentIdx > 0) { setCurrentIdx(currentIdx - 1); setComment(''); }
          break;
        case 'arrowright':
          e.preventDefault();
          if (currentIdx < filteredImages.length - 1) { setCurrentIdx(currentIdx + 1); setComment(''); }
          break;
        case 'escape':
          if (lightboxOpen) setLightboxOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentImage, currentIdx, filteredImages.length, lightboxOpen, doReview, handleSkip]);

  const goTo = (idx: number) => {
    if (idx >= 0 && idx < filteredImages.length) {
      setCurrentIdx(idx);
      setComment('');
      setMessage('');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return '刚刚';
    if (diffH < 24) return `${diffH} 小时前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD} 天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  /* ─── Loading 态 ─── */
  if (loading) {
    return (
      <AuthLayout title="审核中心">
        <div className="rounded-xl overflow-hidden animate-pulse" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div className="flex flex-col lg:flex-row">
            <div className="lg:w-[65%] aspect-[4/3]" style={{ background: C.bg }} />
            <div className="lg:w-[35%] p-6 space-y-4">
              <div className="h-5 w-2/3 rounded" style={{ background: C.border }} />
              <div className="h-4 w-1/2 rounded" style={{ background: C.border }} />
              <div className="h-4 w-3/4 rounded" style={{ background: C.border }} />
              <div className="space-y-2 pt-4">
                <div className="h-12 w-full rounded-lg" style={{ background: C.border }} />
                <div className="h-12 w-full rounded-lg" style={{ background: C.border }} />
                <div className="h-10 w-20 rounded-lg" style={{ background: C.border }} />
              </div>
            </div>
          </div>
        </div>
      </AuthLayout>
    );
  }

  /* ─── 空状态 ─── */
  if (filteredImages.length === 0) {
    return (
      <AuthLayout title="审核中心">
        <FilterBar filter={filter} setFilter={setFilter} counts={counts} />
        <div
          className="text-center py-20 rounded-xl"
          style={{ background: C.surface, border: `1px solid ${C.border}` }}
        >
          <div className="p-4 rounded-full mx-auto mb-4 w-fit" style={{ background: C.bg }}>
            <Image className="w-8 h-8" style={{ color: C.muted, opacity: 0.5 }} />
          </div>
          <p className="font-medium" style={{ color: C.muted }}>
            {filter === 'ALL' ? '暂无图片'
              : filter === 'PENDING' ? '没有待审核的图片 🎉'
              : filter === 'APPROVED' ? '暂无已通过的图片'
              : '暂无已驳回的图片'}
          </p>
          {filter === 'PENDING' && (
            <>
              <p className="text-sm mt-1" style={{ color: C.muted, opacity: 0.6 }}>
                {counts.ALL > 0
                  ? '当前所有任务都已审核完毕'
                  : '可能原因：尚无 SPU 分配给你，或全部审核完毕'}
              </p>
              {counts.ALL > 0 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  {counts.APPROVED > 0 && (
                    <button
                      onClick={() => setFilter('APPROVED')}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                      style={{ background: C.successLight, color: C.successFg }}
                    >
                      查看已通过 ({counts.APPROVED})
                    </button>
                  )}
                  {counts.REJECTED > 0 && (
                    <button
                      onClick={() => setFilter('REJECTED')}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                      style={{ background: C.dangerLight, color: C.dangerFg }}
                    >
                      查看已驳回 ({counts.REJECTED})
                    </button>
                  )}
                  <button
                    onClick={() => setFilter('ALL')}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{ background: C.bg, color: C.muted, border: `1px solid ${C.border}` }}
                  >
                    查看全部 ({counts.ALL})
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="审核中心">
      <FilterBar filter={filter} setFilter={setFilter} counts={counts} />

      {/* ── 消息提示 ── */}
      {message && (
        <div
          className="mb-4 px-4 py-3 rounded-xl text-sm font-medium animate-fade-in-up flex items-center gap-2"
          style={{ background: C.accentLight, color: C.accent }}
        >
          <CheckCircle2 className="w-4 h-4" />
          {message}
        </div>
      )}

      {/* ── 主审核区：左右分栏 ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: C.surface, border: `1px solid ${C.border}` }}
      >
        {/* SPU 上下文头 */}
        <div
          className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap"
          style={{ borderBottom: `1px solid ${C.border}`, background: C.bg }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Package className="w-4 h-4 flex-shrink-0" style={{ color: C.accent }} />
            <span className="font-semibold text-sm truncate" style={{ color: C.fg }}>
              {currentImage?.spu?.name || '未知 SPU'}
            </span>
            {currentImage?.spu?.category && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium flex-shrink-0"
                style={{ background: C.accentLight, color: C.accent }}
              >
                <FolderOpen className="w-3 h-3" />
                {currentImage.spu.category}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
              <User className="w-3.5 h-3.5" />
              {currentImage?.uploadedBy?.name || '-'} · {currentImage?.uploadedBy?.department || '-'}
            </div>
            <StatusBadge status={currentImage?.status || 'PENDING'} />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* ── 左侧：大图预览 ── */}
          <div
            ref={imageRef}
            className="lg:w-[65%] relative group cursor-zoom-in"
            style={{ background: C.bg, minHeight: '420px' }}
            onClick={() => setLightboxOpen(true)}
          >
            {/* 棋盘格背景 */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(45deg, oklch(95% 0 0) 25%, transparent 25%),
                  linear-gradient(-45deg, oklch(95% 0 0) 25%, transparent 25%),
                  linear-gradient(45deg, transparent 75%, oklch(95% 0 0) 75%),
                  linear-gradient(-45deg, transparent 75%, oklch(95% 0 0) 75%)`,
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
              }}
            />
            {currentImage && (
              <img
                src={`/api/images/${currentImage.id}/file`}
                alt={currentImage.filename}
                className="absolute inset-0 w-full h-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            {/* Hover 放大提示 */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/08 transition-all duration-300 flex items-center justify-center">
              <div className="p-3 rounded-full bg-white/20 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100">
                <Maximize2 className="w-6 h-6 text-white drop-shadow-lg" />
              </div>
            </div>
            {/* 键盘提示 */}
            <div className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="flex items-center gap-2 text-[10px] font-medium" style={{ color: C.muted }}>
                <Kbd>A</Kbd> 通过
                <Kbd>R</Kbd> 驳回
                <Kbd>S</Kbd> 跳过
                <Kbd>←→</Kbd> 切换
              </div>
            </div>
            {/* 图片序号 */}
            <div className="absolute top-3 right-3">
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-bold tabular-nums backdrop-blur-sm"
                style={{ background: 'rgba(0,0,0,0.45)', color: 'white' }}
              >
                {currentIdx + 1} / {filteredImages.length}
              </span>
            </div>
          </div>

          {/* ── 右侧：操作面板 ── */}
          <div
            className="lg:w-[35%] flex flex-col"
            style={{ borderLeft: `1px solid ${C.border}` }}
          >
            {/* 图片元信息 */}
            <div className="p-5 space-y-3" style={{ borderBottom: `1px solid ${C.border}` }}>
              <p
                className="text-sm font-bold truncate"
                style={{ color: C.fg }}
                title={currentImage?.filename}
              >
                {currentImage?.filename || '-'}
              </p>
              <div className="flex items-center gap-3 text-xs" style={{ color: C.muted }}>
                <span className="tabular-nums font-medium">{currentImage ? formatSize(currentImage.fileSize) : '-'}</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {currentImage ? formatTime(currentImage.createdAt) : '-'}
                </span>
              </div>
            </div>

            {/* 审核操作（仅 PENDING） */}
            {currentImage?.status === 'PENDING' && (
              <div className="p-5 space-y-4" style={{ borderBottom: `1px solid ${C.border}` }}>
                {/* 审核意见 */}
                <div className="relative">
                  <MessageSquare
                    className="absolute left-3 top-3 w-4 h-4"
                    style={{ color: C.muted }}
                  />
                  <input
                    ref={commentRef}
                    type="text"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="审核意见（选填，直接回车=通过）…"
                    className="w-full pl-9 pr-4 py-3 rounded-xl text-[13px] transition-all duration-150 outline-none"
                    style={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      color: C.fg,
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = C.accent;
                      e.target.style.boxShadow = `0 0 0 3px oklch(58% 0.18 255 / 0.1)`;
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = C.border;
                      e.target.style.boxShadow = 'none';
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doReview('APPROVED');
                    }}
                  />
                </div>

                {/* 操作按钮组 */}
                <div className="flex gap-3">
                  <ActionButton
                    onClick={() => doReview('APPROVED')}
                    disabled={!!reviewingId}
                    variant="success"
                    icon={CheckCircle2}
                    label="通过"
                    shortcut="A"
                  />
                  <ActionButton
                    onClick={() => doReview('REJECTED')}
                    disabled={!!reviewingId}
                    variant="danger"
                    icon={XCircle}
                    label="驳回"
                    shortcut="R"
                  />
                  <button
                    onClick={handleSkip}
                    disabled={!!reviewingId || currentIdx >= filteredImages.length - 1}
                    className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150"
                    style={{
                      background: C.bg,
                      color: C.muted,
                      opacity: (reviewingId || currentIdx >= filteredImages.length - 1) ? 0.4 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!reviewingId && currentIdx < filteredImages.length - 1) {
                        (e.target as HTMLButtonElement).style.background = 'oklch(0 0 0 / 0.06)';
                        (e.target as HTMLButtonElement).style.color = C.fg;
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLButtonElement).style.background = C.bg;
                      (e.target as HTMLButtonElement).style.color = C.muted;
                    }}
                    title="跳过 (S)"
                  >
                    <SkipForward className="w-4 h-4" />
                    跳过
                  </button>
                </div>
              </div>
            )}

            {/* 审核历史 */}
            {currentImage?.reviews && currentImage.reviews.length > 0 && (
              <div className="p-5 space-y-2 flex-1 overflow-y-auto">
                <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>审核记录</p>
                {currentImage.reviews.map((r) => {
                  const isApproved = r.action === 'APPROVED';
                  return (
                    <div
                      key={r.id}
                      className="text-xs rounded-xl px-3 py-2.5 flex items-start gap-2"
                      style={{
                        background: isApproved ? C.successLight : C.dangerLight,
                        color: isApproved ? C.successFg : C.dangerFg,
                      }}
                    >
                      {isApproved ? (
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      )}
                      <div>
                        <span className="font-semibold">{r.reviewer.name}</span>
                        <span className="opacity-70"> · {isApproved ? '已通过' : '已驳回'}</span>
                        <span className="opacity-50 ml-1">{formatTime(r.createdAt)}</span>
                        {r.comment && (
                          <p className="mt-0.5 opacity-80">"{r.comment}"</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 非 PENDING 占位 */}
            {currentImage?.status !== 'PENDING' && !(currentImage?.reviews?.length) && (
              <div className="p-5 flex-1 flex items-center justify-center">
                <p className="text-xs" style={{ color: C.muted }}>暂无审核记录</p>
              </div>
            )}
          </div>
        </div>

        {/* ── 底部缩略图导航条 ── */}
        <div
          className="px-3 py-3 flex items-center gap-2 overflow-x-auto"
          style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}
        >
          {/* 上一张按钮 */}
          <button
            onClick={() => goTo(currentIdx - 1)}
            disabled={currentIdx === 0}
            className="flex-shrink-0 p-1.5 rounded-lg transition-all"
            style={{ color: currentIdx === 0 ? C.muted : C.fg, opacity: currentIdx === 0 ? 0.3 : 1 }}
            title="上一张 (←)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* 缩略图列表 */}
          <div className="flex gap-2 flex-1 overflow-x-auto pb-1">
            {filteredImages.map((img, idx) => {
              const isActive = idx === currentIdx;
              const badge = statusBadgeDef[img.status];
              return (
                <button
                  key={img.id}
                  onClick={() => goTo(idx)}
                  className="flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden transition-all duration-200 relative group/thumb"
                  style={{
                    outline: isActive ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                    outlineOffset: '2px',
                    opacity: isActive ? 1 : 0.55,
                    transform: isActive ? 'scale(1.05)' : '',
                  }}
                >
                  {/* 棋盘格背景 */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `linear-gradient(45deg, oklch(97% 0 0) 25%, transparent 25%),
                        linear-gradient(-45deg, oklch(97% 0 0) 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, oklch(97% 0 0) 75%),
                        linear-gradient(-45deg, transparent 75%, oklch(97% 0 0) 75%)`,
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                    }}
                  />
                  <img
                    src={`/api/images/${img.id}/file`}
                    alt={img.filename}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  {/* 状态指示条 */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-[3px]"
                    style={{ background: badge.fg, opacity: isActive ? 1 : 0.6 }}
                  />
                  {/* Hover 序号 */}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{idx + 1}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 下一张按钮 */}
          <button
            onClick={() => goTo(currentIdx + 1)}
            disabled={currentIdx >= filteredImages.length - 1}
            className="flex-shrink-0 p-1.5 rounded-lg transition-all"
            style={{ color: currentIdx >= filteredImages.length - 1 ? C.muted : C.fg, opacity: currentIdx >= filteredImages.length - 1 ? 0.3 : 1 }}
            title="下一张 (→)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Lightbox ── */}
      {lightboxOpen && currentImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)' }}
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full transition-colors"
            style={{ background: 'rgba(255,255,255,0.1)' }}
            onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'; }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
            onClick={() => setLightboxOpen(false)}
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); goTo(currentIdx - 1); }}
              disabled={currentIdx === 0}
              className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-30"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-white text-sm font-bold tabular-nums">
              {currentIdx + 1} / {filteredImages.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); goTo(currentIdx + 1); }}
              disabled={currentIdx >= filteredImages.length - 1}
              className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-30"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <img
            src={currentImage.storedPath}
            alt={currentImage.filename}
            className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </AuthLayout>
  );
}

/* ═══════════════════════════════ FilterBar ═══════════════════════════════ */
function FilterBar({
  filter,
  setFilter,
  counts,
}: {
  filter: string;
  setFilter: (f: string) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex items-center gap-2 mb-5 flex-wrap">
      {[
        { key: 'ALL', label: '全部' },
        { key: 'PENDING', label: '待审核' },
        { key: 'APPROVED', label: '已通过' },
        { key: 'REJECTED', label: '已驳回' },
      ].map(({ key, label }) => {
        const active = filter === key;
        const badgeCount = counts[key] || 0;
        return (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all duration-200"
            style={{
              background: active ? C.surface : 'transparent',
              color: active ? C.fg : C.muted,
              border: active ? `1px solid ${C.border}` : '1px solid transparent',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {label}
            <span
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold"
              style={{
                background: active ? C.accentLight : 'oklch(0 0 0 / 0.04)',
                color: active ? C.accent : C.muted,
              }}
            >
              {badgeCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════ ActionButton ═══════════════════════════════ */
function ActionButton({
  onClick,
  disabled,
  variant,
  icon: Icon,
  label,
  shortcut,
}: {
  onClick: () => void;
  disabled: boolean;
  variant: 'success' | 'danger';
  icon: any;
  label: string;
  shortcut: string;
}) {
  const bg = variant === 'success' ? C.success : C.danger;
  const hoverBg = variant === 'success' ? C.successHover : C.dangerHover;
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
      style={{
        background: hovered && !disabled ? hoverBg : bg,
        color: 'white',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transform: hovered && !disabled ? 'translateY(-1px)' : '',
        boxShadow: hovered && !disabled
          ? variant === 'success'
            ? '0 4px 16px oklch(66% 0.16 160 / 0.35)'
            : '0 4px 16px oklch(56% 0.18 25 / 0.3)'
          : '0 1px 3px rgba(0,0,0,0.08)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(e) => {
        if (!disabled) (e.target as HTMLButtonElement).style.transform = 'scale(0.96)';
      }}
      onMouseUp={(e) => {
        if (!disabled) (e.target as HTMLButtonElement).style.transform = hovered ? 'translateY(-1px)' : '';
      }}
    >
      <Icon className="w-4 h-4" />
      {label}
      <span className="opacity-50 text-[10px] ml-0.5">{shortcut}</span>
    </button>
  );
}

/* ═══════════════════════════════ Kbd ═══════════════════════════════ */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 rounded text-[9px] font-bold"
      style={{
        background: 'oklch(100% 0 0 / 0.15)',
        color: 'oklch(100% 0 0 / 0.6)',
        border: '1px solid oklch(100% 0 0 / 0.2)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </kbd>
  );
}
