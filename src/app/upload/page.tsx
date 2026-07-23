'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import AuthLayout from '@/components/AuthLayout';
import {
  Upload,
  Plus,
  Package,
  Image,
  Trash2,
  ChevronRight,
  ArrowLeft,
  FolderOpen,
  X,
  FileImage,
  Hash,
  Store,
  Calendar,
  Search,
} from 'lucide-react';
import { CATEGORIES } from '@/lib/categories';
import { STORES } from '@/lib/stores';

interface SpuItem {
  id: string;
  name: string;
  category: string;
  countryStyle: string;
  shopName: string;
  status: string;
  createdAt: string;
  uploadedBy: { name: string; department: string };
  _count: { images: number };
  _imageStatuses: { approved: number; rejected: number; pending: number };
  images: { id: string; storedPath: string }[];
}

interface ImageItem {
  id: string;
  filename: string;
  storedPath: string;
  fileSize: number;
  mimeType: string;
  status: string;
  createdAt: string;
}

/* ─── 直接用 oklch — 避开 CSS 变量在 inline style 的天坑 ─── */
const C = {
  accent:       'oklch(58% 0.18 255)',
  accentHover:  'oklch(50% 0.18 255)',
  accentLight:  'oklch(58% 0.18 255 / 0.06)',
  accentMed:    'oklch(58% 0.18 255 / 0.12)',
  success:      'oklch(66% 0.16 160)',
  successLight: 'oklch(66% 0.16 160 / 0.08)',
  successFg:    'oklch(45% 0.15 155)',
  danger:       'oklch(56% 0.18 25)',
  dangerLight:  'oklch(56% 0.18 25 / 0.06)',
  dangerFg:     'oklch(45% 0.16 25)',
  warn:         'oklch(70% 0.15 80)',
  warnLight:    'oklch(70% 0.15 80 / 0.08)',
  warnFg:       'oklch(50% 0.14 75)',
  archive:      'oklch(60% 0.04 250)',
  archiveLight: 'oklch(60% 0.04 250 / 0.06)',
  archiveFg:    'oklch(40% 0.04 250)',
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

function StatusDot({ status }: { status: string }) {
  const def = statusBadgeDef[status] || statusBadgeDef.PENDING;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-semibold gap-1"
      style={{ background: def.bg, color: def.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: def.fg }} />
      {def.label}
    </span>
  );
}

export default function UploadPage() {
  const [spus, setSpus] = useState<SpuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [spuName, setSpuName] = useState('');
  const [category, setCategory] = useState('');
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [countryStyle, setCountryStyle] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopNameSuggestions, setShopNameSuggestions] = useState<string[]>([]);
  const [showShopNameDropdown, setShowShopNameDropdown] = useState(false);
  const shopNameRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const categoryRef = useRef<HTMLDivElement>(null);

  const [selectedSpu, setSelectedSpu] = useState<SpuItem | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSpus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/spus?limit=50');
      const data = await res.json();
      if (data.spus) setSpus(data.spus);
    } catch (err) {
      console.error('fetchSpus error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSpus(); }, [fetchSpus]);

  const fetchImages = async (spuId: string) => {
    setImagesLoading(true);
    const res = await fetch(`/api/spus/${spuId}/upload`);
    const data = await res.json();
    if (Array.isArray(data)) setImages(data);
    setImagesLoading(false);
  };

  const handleCategoryInput = (value: string) => {
    setCategory(value);
    if (value.trim()) {
      const filtered = CATEGORIES.filter((c) => c.includes(value.trim()));
      setCategorySuggestions(filtered);
      setShowCategoryDropdown(filtered.length > 0);
    } else {
      setCategorySuggestions([]);
      setShowCategoryDropdown(false);
    }
  };

  const handleShopNameInput = (value: string) => {
    setShopName(value);
    if (value.trim()) {
      const filtered = STORES.filter((s) => s.toLowerCase().includes(value.trim().toLowerCase()));
      setShopNameSuggestions(filtered);
      setShowShopNameDropdown(filtered.length > 0);
    } else {
      setShopNameSuggestions([]);
      setShowShopNameDropdown(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (shopNameRef.current && !shopNameRef.current.contains(e.target as Node)) {
        setShowShopNameDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCreateSpu = async () => {
    if (!spuName.trim()) { setMessage('请填写SPU名称'); return; }
    if (!category.trim()) { setMessage('请选择品类'); return; }
    if (!CATEGORIES.includes(category.trim())) { setMessage('无效的品类名称'); return; }
    if (shopName.trim() && !STORES.includes(shopName.trim())) { setMessage('无效的店铺名称，请从列表中选择'); return; }
    setCreating(true);
    const res = await fetch('/api/spus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: spuName.trim(), category: category.trim(), countryStyle: countryStyle.trim(), shopName: shopName.trim() }),
    });
    if (res.ok) {
      setSpuName(''); setCategory(''); setCountryStyle(''); setShopName(''); setShowCreate(false);
      setMessage('SPU任务创建成功');
      fetchSpus();
    } else {
      const data = await res.json();
      setMessage(data.error || '创建失败');
    }
    setCreating(false);
  };

  const selectSpu = (spu: SpuItem) => { setSelectedSpu(spu); setMessage(''); fetchImages(spu.id); };
  const backToList = () => { setSelectedSpu(null); setImages([]); fetchSpus(); };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!selectedSpu || acceptedFiles.length === 0) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    const oversized = acceptedFiles.find((f) => f.size > MAX_SIZE);
    if (oversized) {
      setMessage(`文件 "${oversized.name}" 超过 10MB 限制`);
      return;
    }
    setUploading(true);
    setMessage('');
    const formData = new FormData();
    acceptedFiles.forEach((f) => formData.append('files', f));
    try {
      const res = await fetch(`/api/spus/${selectedSpu.id}/upload`, { method: 'POST', body: formData });
      if (res.ok) {
        setMessage(`已提交 ${acceptedFiles.length} 张图片`);
        fetchImages(selectedSpu.id);
        fetchSpus();
      } else {
        const data = await res.json();
        setMessage(data.error || '上传失败');
      }
    } catch {
      setMessage('上传失败，请重试');
    }
    setUploading(false);
  }, [selectedSpu]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] },
    multiple: true,
    maxFiles: 50,
  });

  const handleDelete = async (imageId: string) => {
    if (!selectedSpu || !confirm('确定删除？')) return;
    await fetch(`/api/spus/${selectedSpu.id}/upload`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId }),
    });
    fetchImages(selectedSpu.id);
    fetchSpus();
  };

  /* 搜索过滤 */
  const filteredSpus = searchQuery.trim()
    ? spus.filter((spu) => {
        const q = searchQuery.trim().toLowerCase();
        return (
          spu.name.toLowerCase().includes(q) ||
          spu.category.toLowerCase().includes(q) ||
          (spu.shopName && spu.shopName.toLowerCase().includes(q))
        );
      })
    : spus;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  /* ═══════════════════════════════ SPU Detail View ═══════════════════════════════ */
  if (selectedSpu) {
    return (
      <AuthLayout title="图片上传">
        {/* 返回导航 */}
        <button
          onClick={backToList}
          className="inline-flex items-center gap-1.5 text-sm mb-5 transition-all duration-150 rounded-[var(--radius-input)] px-3 py-1.5 -ml-3 hover:bg-[oklch(58%_0.18_255/0.04)]"
          style={{ color: C.muted }}
        >
          <ArrowLeft className="w-4 h-4" /> 返回任务列表
        </button>

        {/* SPU 信息头 */}
        <div
          className="p-5 rounded-[var(--radius-card)] mb-6 flex flex-wrap items-start justify-between gap-4"
          style={{ background: C.surface, border: `1px solid ${C.border}` }}
        >
                      <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-bold tracking-tight" style={{ color: C.fg }}>
                {selectedSpu.name}
              </h2>
            </div>
            {/* 图片状态汇总 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.successFg }}>
                <span className="w-2 h-2 rounded-full" style={{ background: C.success }} />
                {selectedSpu._imageStatuses.approved} 已通过
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.dangerFg }}>
                <span className="w-2 h-2 rounded-full" style={{ background: C.danger }} />
                {selectedSpu._imageStatuses.rejected} 被驳回
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.warnFg }}>
                <span className="w-2 h-2 rounded-full" style={{ background: C.warn }} />
                {selectedSpu._imageStatuses.pending} 待审核
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[13px]" style={{ color: C.muted }}>
              {selectedSpu.category && (
                <span className="inline-flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5" />
                  {selectedSpu.category}
                </span>
              )}
              {selectedSpu.shopName && (
                <span className="inline-flex items-center gap-1">
                  <Store className="w-3.5 h-3.5" />
                  {selectedSpu.shopName}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Image className="w-3.5 h-3.5" />
                {selectedSpu._count.images} 张图片
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(selectedSpu.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 拖拽上传区 */}
        <div
          {...getRootProps()}
          className="relative cursor-pointer transition-all duration-300 mb-6 group"
          style={{
            border: `2px dashed ${isDragActive ? C.accent : C.border}`,
            borderRadius: 'var(--radius-zone)',
            background: isDragActive ? C.accentLight : C.surface,
            transform: isDragActive ? 'scale(1.01)' : 'scale(1)',
          }}
        >
          <input {...getInputProps()} />
          <div
            className="absolute inset-0 rounded-[var(--radius-zone)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{ background: C.accentLight }}
          />
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center relative z-10">
            {uploading ? (
              <>
                <div className="w-10 h-10 rounded-full animate-spin mb-4" style={{ border: `3px solid ${C.border}`, borderTopColor: C.accent }} />
                <p className="text-sm font-semibold" style={{ color: C.accent }}>正在上传…</p>
                <p className="text-xs mt-1" style={{ color: C.muted }}>请勿关闭页面</p>
              </>
            ) : isDragActive ? (
              <>
                <div className="p-4 rounded-full mb-4" style={{ background: C.accentMed }}>
                  <Upload className="w-8 h-8" style={{ color: C.accent }} />
                </div>
                <p className="text-[15px] font-semibold" style={{ color: C.accent }}>松开以上传图片</p>
              </>
            ) : (
              <>
                <div className="p-4 rounded-full mb-4" style={{ background: C.bg }}>
                  <FileImage className="w-8 h-8" style={{ color: C.muted }} />
                </div>
                <p className="text-[15px] font-semibold" style={{ color: C.fg }}>
                  拖拽图片到此处，或<span style={{ color: C.accent }}>点击选择</span>
                </p>
                <p className="text-xs mt-2" style={{ color: C.muted }}>
                  支持 JPG / PNG / WebP / SVG · 单文件 ≤ 10MB · 最多 20 张
                </p>
              </>
            )}
          </div>
        </div>

        {message && (
          <div
            className="mb-4 px-4 py-3 rounded-[var(--radius-input)] text-sm font-medium animate-fade-in-up"
            style={{ background: C.accentLight, color: C.accent }}
          >
            {message}
          </div>
        )}

        {/* 图片网格 */}
        {imagesLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="rounded-[var(--radius-card)] overflow-hidden animate-pulse"
                style={{ background: C.surface, border: `1px solid ${C.border}` }}
              >
                <div className="aspect-square" style={{ background: C.bg }} />
                <div className="p-3 space-y-2">
                  <div className="h-3 w-3/4 rounded" style={{ background: C.border }} />
                  <div className="h-2.5 w-1/3 rounded" style={{ background: C.border }} />
                </div>
              </div>
            ))}
          </div>
        ) : images.length === 0 ? (
          <div
            className="text-center py-20 rounded-[var(--radius-card)]"
            style={{ background: C.surface, border: `1px solid ${C.border}` }}
          >
            <div className="p-4 rounded-full mx-auto mb-4 w-fit" style={{ background: C.bg }}>
              <FolderOpen className="w-8 h-8" style={{ color: C.muted, opacity: 0.5 }} />
            </div>
            <p className="font-medium" style={{ color: C.muted }}>暂无图片</p>
            <p className="text-sm mt-1" style={{ color: C.muted, opacity: 0.6 }}>
              拖拽文件到上方区域开始上传
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="group overflow-hidden rounded-[var(--radius-card)] transition-all duration-200 hover:-translate-y-[2px] hover:shadow-lg"
                style={{ background: C.surface, border: `1px solid ${C.border}` }}
              >
                <div className="aspect-square relative" style={{ background: C.bg }}>
                  <img
                    src={`/api/images/${img.id}/file`}
                    alt={img.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      const parent = (e.target as HTMLImageElement).parentElement;
                      if (parent && !parent.querySelector('.fallback')) {
                        const div = document.createElement('div');
                        div.className = 'fallback absolute inset-0 flex items-center justify-center';
                        div.style.background = C.bg;
                        div.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${encodeURIComponent(C.muted)}" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
                        parent.appendChild(div);
                      }
                    }}
                  />
                  {/* hover 删除按钮 */}
                  <button
                    onClick={() => handleDelete(img.id)}
                    className="absolute top-2 right-2 p-2 rounded-[10px] opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
                    style={{ background: 'rgba(0,0,0,0.5)' }}
                    onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = C.danger; }}
                    onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = 'rgba(0,0,0,0.5)'; }}
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'white' }} />
                  </button>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusDot status={img.status} />
                  </div>
                  <p className="text-xs font-semibold truncate" style={{ color: C.fg }} title={img.filename}>
                    {img.filename}
                  </p>
                  <p className="text-[11px] mt-1 tabular-nums" style={{ color: C.muted, fontFamily: 'var(--font-mono)' }}>
                    {formatSize(img.fileSize)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </AuthLayout>
    );
  }

  /* ═══════════════════════════════ SPU List View ═══════════════════════════════ */
  return (
    <AuthLayout title="图片上传">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight" style={{ color: C.fg }}>
            图片上传
          </h2>
          <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>
            {spus.length} 个 SPU 任务{searchQuery.trim() && filteredSpus.length !== spus.length ? ` · 匹配 ${filteredSpus.length} 个` : ''}
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setMessage(''); }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-input)] text-sm font-semibold transition-all duration-200 shadow-sm"
          style={{ background: C.accent, color: 'white' }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.background = C.accentHover;
            (e.target as HTMLButtonElement).style.transform = 'translateY(-1px)';
            (e.target as HTMLButtonElement).style.boxShadow = '0 4px 12px oklch(58% 0.18 255 / 0.35)';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.background = C.accent;
            (e.target as HTMLButtonElement).style.transform = '';
            (e.target as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
          }}
        >
          <Plus className="w-4 h-4" />
          创建SPU任务
        </button>
      </div>

      {/* Create SPU Form */}
      {showCreate && (
        <div
          className="p-6 rounded-[var(--radius-card)] mb-6 animate-fade-in-up"
          style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold" style={{ color: C.fg }}>创建新 SPU 任务</h3>
            <button
              onClick={() => setShowCreate(false)}
              className="p-1.5 rounded-[var(--radius-input)] transition-colors hover:bg-[oklch(0_0_0/0.04)]"
              style={{ color: C.muted }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {message && (
            <div className="mb-4 px-4 py-2.5 rounded-[var(--radius-input)] text-sm font-medium" style={{ background: C.accentLight, color: C.accent }}>
              {message}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-[13px] font-semibold mb-2" style={{ color: C.fg }}>
                SPU 名称 <span style={{ color: C.danger }}>*</span>
              </label>
              <input
                type="text" value={spuName}
                onChange={(e) => setSpuName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-all duration-150 focus:ring-2 focus:ring-[oklch(58%_0.18_255/0.2)]"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.fg }}
                placeholder="如：夏季T恤-纯色款"
              />
            </div>
            <div ref={categoryRef} className="relative">
              <label className="block text-[13px] font-semibold mb-2" style={{ color: C.fg }}>
                品类 <span style={{ color: C.danger }}>*</span>
              </label>
              <input
                type="text" value={category}
                onChange={(e) => handleCategoryInput(e.target.value)}
                onFocus={() => { if (category.trim() && categorySuggestions.length > 0) setShowCategoryDropdown(true); }}
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-all duration-150 focus:ring-2 focus:ring-[oklch(58%_0.18_255/0.2)]"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.fg }}
                placeholder="输入品类名称自动补全"
                autoComplete="off"
              />
              {showCategoryDropdown && (
                <div
                  className="absolute z-20 w-full mt-1.5 rounded-[var(--radius-input)] shadow-lg max-h-48 overflow-y-auto py-1"
                  style={{ background: C.surface, border: `1px solid ${C.border}` }}
                >
                  {categorySuggestions.map((cat) => (
                    <button
                      key={cat} type="button"
                      onClick={() => { setCategory(cat); setShowCategoryDropdown(false); }}
                      className="w-full text-left px-3.5 py-2.5 text-sm transition-colors hover:bg-[oklch(58%_0.18_255/0.04)]"
                      style={{ color: C.fg }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[13px] font-semibold mb-2" style={{ color: C.fg }}>
                国家款式名称
              </label>
              <input
                type="text" value={countryStyle}
                onChange={(e) => setCountryStyle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-all duration-150 focus:ring-2 focus:ring-[oklch(58%_0.18_255/0.2)]"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.fg }}
                placeholder="如：儿童衣架-三角植绒29-US1"
              />
            </div>
            <div ref={shopNameRef} className="relative">
              <label className="block text-[13px] font-semibold mb-2" style={{ color: C.fg }}>
                店铺名称
              </label>
              <input
                type="text" value={shopName}
                onChange={(e) => handleShopNameInput(e.target.value)}
                onFocus={() => { if (shopName.trim() && shopNameSuggestions.length > 0) setShowShopNameDropdown(true); }}
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-all duration-150 focus:ring-2 focus:ring-[oklch(58%_0.18_255/0.2)]"
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.fg }}
                placeholder="输入店铺名称自动补全"
                autoComplete="off"
              />
              {showShopNameDropdown && (
                <div
                  className="absolute z-20 w-full mt-1.5 rounded-[var(--radius-input)] shadow-lg max-h-48 overflow-y-auto py-1"
                  style={{ background: C.surface, border: `1px solid ${C.border}` }}
                >
                  {shopNameSuggestions.map((store) => (
                    <button
                      key={store} type="button"
                      onClick={() => { setShopName(store); setShowShopNameDropdown(false); }}
                      className="w-full text-left px-3.5 py-2.5 text-sm transition-colors hover:bg-[oklch(58%_0.18_255/0.04)]"
                      style={{ color: C.fg }}
                    >
                      {store}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={handleCreateSpu} disabled={creating}
              className="px-5 py-2.5 rounded-[var(--radius-input)] text-sm font-semibold transition-all duration-200 shadow-sm"
              style={{
                background: C.accent,
                color: 'white',
                opacity: creating ? 0.6 : 1,
                cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? '创建中…' : '创建任务'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-5 py-2.5 rounded-[var(--radius-input)] text-sm font-medium transition-colors hover:bg-[oklch(0_0_0/0.04)]"
              style={{ background: C.bg, color: C.muted }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {message && !showCreate && (
        <div
          className="mb-4 px-4 py-3 rounded-[var(--radius-input)] text-sm font-medium animate-fade-in-up"
          style={{ background: C.accentLight, color: C.accent }}
        >
          {message}
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索 SPU 名称、品类或店铺…"
          className="w-full pl-10 pr-4 py-2.5 rounded-[var(--radius-input)] text-sm transition-all duration-150 focus:ring-2 focus:ring-[oklch(58%_0.18_255/0.2)]"
          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.fg }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[oklch(0_0_0/0.04)]"
            style={{ color: C.muted }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* SPU Cards Grid */}
      {loading ? (
        <SpuSkeleton />
      ) : spus.length === 0 ? (
        <div
          className="text-center py-20 rounded-[var(--radius-card)]"
          style={{ background: C.surface, border: `1px solid ${C.border}` }}
        >
          <div className="p-4 rounded-full mx-auto mb-4 w-fit" style={{ background: C.bg }}>
            <Package className="w-8 h-8" style={{ color: C.muted, opacity: 0.5 }} />
          </div>
          <p className="font-medium" style={{ color: C.muted }}>暂无 SPU 任务</p>
          <p className="text-sm mt-1" style={{ color: C.muted, opacity: 0.6 }}>
            点击上方「创建SPU任务」开始
          </p>
        </div>
      ) : filteredSpus.length === 0 ? (
        <div
          className="text-center py-20 rounded-[var(--radius-card)]"
          style={{ background: C.surface, border: `1px solid ${C.border}` }}
        >
          <div className="p-4 rounded-full mx-auto mb-4 w-fit" style={{ background: C.bg }}>
            <Search className="w-8 h-8" style={{ color: C.muted, opacity: 0.5 }} />
          </div>
          <p className="font-medium" style={{ color: C.muted }}>未找到匹配的 SPU</p>
          <p className="text-sm mt-1" style={{ color: C.muted, opacity: 0.6 }}>
            试试其他关键词
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {filteredSpus.map((spu) => (
            <div
              key={spu.id}
              onClick={() => selectSpu(spu)}
              className="group cursor-pointer rounded-[var(--radius-card)] overflow-hidden transition-all duration-300"
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
                e.currentTarget.style.borderColor = C.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = '';
                e.currentTarget.style.borderColor = C.border;
              }}
            >
              {/* 图片区域 1:1 */}
              <div className="relative aspect-square overflow-hidden" style={{ background: C.bg }}>
                {spu.images[0] ? (
                  <img
                    src={`/api/images/${spu.images[0].id}/file`}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null}
                {/* 没有图时的占位 */}
                {!spu.images[0] && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Image className="w-10 h-10" style={{ color: C.muted, opacity: 0.25 }} />
                  </div>
                )}
                {/* 底部渐变叠加层 */}
                <div
                  className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
                  style={{
                    background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent)',
                  }}
                />
                {/* 叠加层上的标题 */}
                <div className="absolute bottom-3 left-3 right-3">
                  <h3 className="text-sm font-bold text-white truncate drop-shadow-sm">
                    {spu.name}
                  </h3>
                </div>
                {/* 右上角箭头 */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="p-1.5 rounded-full backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.2)' }}>
                    <ChevronRight className="w-4 h-4 text-white" />
                  </div>
                </div>
              </div>

              {/* 卡片底部信息 */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {spu.category && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-semibold"
                      style={{ background: C.accentLight, color: C.accent }}
                    >
                      {spu.category}
                    </span>
                  )}
                  {spu.shopName && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-semibold"
                      style={{ background: C.archiveLight, color: C.archiveFg }}
                    >
                      {spu.shopName}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px]" style={{ color: C.muted }}>
                    <span className="font-semibold tabular-nums" style={{ color: C.fg }}>
                      {spu._count.images}
                    </span>
                    张图片
                    <span className="opacity-30">·</span>
                    <span>{spu.uploadedBy.name}</span>
                  </div>
                  {/* 图片状态明细 */}
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold tabular-nums">
                    {spu._imageStatuses.approved > 0 && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: C.successLight, color: C.successFg }}>
                        {spu._imageStatuses.approved}✓
                      </span>
                    )}
                    {spu._imageStatuses.rejected > 0 && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: C.dangerLight, color: C.dangerFg }}>
                        {spu._imageStatuses.rejected}✗
                      </span>
                    )}
                    {spu._imageStatuses.pending > 0 && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: C.warnLight, color: C.warnFg }}>
                        {spu._imageStatuses.pending}○
                      </span>
                    )}
                    {spu._count.images === 0 && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: C.archiveLight, color: C.archiveFg }}>空</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AuthLayout>
  );
}

/* ═══════════════════════════════ SPU 列表骨架屏 ═══════════════════════════════ */
function SpuSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="rounded-[var(--radius-card)] overflow-hidden animate-pulse"
          style={{ background: C.surface, border: `1px solid ${C.border}` }}
        >
          <div className="aspect-square" style={{ background: C.bg }} />
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <div className="h-5 w-16 rounded-full" style={{ background: C.border }} />
              <div className="h-5 w-12 rounded-full" style={{ background: C.border }} />
            </div>
            <div className="flex justify-between items-center">
              <div className="h-3 w-24 rounded" style={{ background: C.border }} />
              <div className="h-5 w-14 rounded-full" style={{ background: C.border }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
