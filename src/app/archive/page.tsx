'use client';

import { useEffect, useState, useCallback } from 'react';
import AuthLayout from '@/components/AuthLayout';
import {
  Archive, Download, Package, Image, CheckSquare, Square,
  FolderDown, X, Loader2, ChevronDown, ChevronUp, FileImage,
} from 'lucide-react';

interface ArchiveImage {
  id: string;
  storedPath: string;
  filename: string;
  fileSize: number | null;
}

interface ArchiveItem {
  id: string;
  spuName: string;
  category: string;
  countryStyle: string;
  shopName: string;
  uploadedByName: string;
  department: string;
  imageCount: number;
  archivedAt: string;
  spu: { images: ArchiveImage[] };
}

export default function ArchivePage() {
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 展开的 SPU
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 选中的图片（跨 SPU）
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  // 下载状态
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });

  useEffect(() => {
    setLoading(true);
    setExpandedIds(new Set());
    setSelectedImages(new Set());
    fetch(`/api/archives?page=${page}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        setArchives(data.archives || []);
        setTotalPages(data.totalPages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page]);

  // ─── 展开/折叠 ───
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── 图片选择 ───
  const toggleImageSelect = (imageId: string) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      next.has(imageId) ? next.delete(imageId) : next.add(imageId);
      return next;
    });
  };

  const selectAllInSpu = (archiveItem: ArchiveItem) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      const imageIds = archiveItem.spu?.images?.map((i) => i.id) || [];
      const allSelected = imageIds.every((id) => prev.has(id));
      if (allSelected) {
        imageIds.forEach((id) => next.delete(id));
      } else {
        imageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectAllImages = () => {
    const allIds = archives.flatMap((a) => (a.spu?.images || []).map((i) => i.id));
    setSelectedImages(new Set(allIds));
  };

  const clearSelection = () => setSelectedImages(new Set());

  const isAllImagesSelected =
    archives.length > 0 &&
    archives.every((a) => (a.spu?.images || []).every((i) => selectedImages.has(i.id)));

  // ─── 单个图片下载 ───
  const handleSingleDownload = async (e: React.MouseEvent, image: ArchiveImage) => {
    e.stopPropagation();
    setDownloadingId(image.id);
    try {
      const res = await fetch(`/api/images/${image.id}/file`);
      if (!res.ok) throw new Error('下载失败');
      const blob = await res.blob();
      triggerDownload(blob, image.filename);
    } catch {
      alert('下载失败');
    }
    setDownloadingId(null);
  };

  // ─── SPU 全部下载 ───
  const handleSpuDownload = async (e: React.MouseEvent, archiveItem: ArchiveItem) => {
    e.stopPropagation();
    setDownloadingId(archiveItem.id);
    try {
      const res = await fetch(`/api/archives/${archiveItem.id}/download`);
      if (!res.ok) throw new Error('下载失败');
      const blob = await res.blob();
      triggerDownload(blob, `${archiveItem.spuName}.zip`);
    } catch {
      alert('下载失败');
    }
    setDownloadingId(null);
  };

  // ─── 批量下载选中图片 ───
  const handleBatchDownload = useCallback(async () => {
    if (selectedImages.size === 0) return;
    setBatchDownloading(true);
    setProgress({ current: 0, total: selectedImages.size, label: '正在打包...' });

    try {
      const res = await fetch('/api/images/batch-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedImages) }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '批量下载失败' }));
        alert(data.error || '批量下载失败');
        return;
      }

      const contentLength = res.headers.get('Content-Length');
      const total = contentLength ? parseInt(contentLength) : 0;
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
          setProgress({
            current: received,
            total,
            label: `下载中 ${formatSize(received)} / ${formatSize(total)}`,
          });
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerDownload(blob, `图片下载_${selectedImages.size}张_${ts}.zip`);
      setProgress({ current: 0, total: 0, label: '' });
    } catch {
      alert('批量下载失败');
    }
    setBatchDownloading(false);
  }, [selectedImages]);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (d: string) => new Date(d).toLocaleString('zh-CN');

  return (
    <AuthLayout>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">下载中心</h2>
        </div>
        <div className="flex items-center gap-2">
          {archives.length > 0 && (
            <>
              <button
                onClick={isAllImagesSelected ? clearSelection : selectAllImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors text-gray-600"
              >
                {isAllImagesSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                {isAllImagesSelected ? '取消全选' : '全选所有图片'}
              </button>
              {selectedImages.size > 0 && (
                <span className="text-xs text-blue-600 font-medium">
                  已选 {selectedImages.size} 张
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 批量下载浮动操作条 */}
      {selectedImages.size > 0 && (
        <div className="sticky top-0 z-30 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <FolderDown className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">
              已选择 {selectedImages.size} 张图片
            </span>
            {batchDownloading && progress.total > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-blue-600">{progress.label}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-blue-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> 取消
            </button>
            <button
              onClick={handleBatchDownload}
              disabled={batchDownloading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-all shadow-sm"
            >
              {batchDownloading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 打包中...</>
              ) : (
                <><Download className="w-4 h-4" /> 下载选中 ({selectedImages.size}张)</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 加载态 */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : archives.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Archive className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">暂无下载内容</p>
          <p className="text-xs text-gray-300 mt-1">审核通过的图片将自动出现在这里</p>
        </div>
      ) : (
        <>
          {/* 卡片列表 */}
          <div className="space-y-4">
            {archives.map((a) => {
              const isExpanded = expandedIds.has(a.id);
              const images = a.spu?.images || [];
              const selectedInThisSpu = images.filter((i) => selectedImages.has(i.id)).length;
              const allInThisSpuSelected = images.length > 0 && selectedInThisSpu === images.length;

              return (
                <div
                  key={a.id}
                  className={`bg-white rounded-xl border-2 overflow-hidden transition-all duration-200 ${
                    isExpanded ? 'border-blue-300 shadow-md' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* ── 卡片头部 ── */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer select-none"
                    onClick={() => toggleExpand(a.id)}
                  >
                    {/* 缩略图 */}
                    <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                      {images[0] ? (
                        <img
                          src={`/api/images/${images[0].id}/file`}
                          alt={a.spuName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <Image className="w-6 h-6 text-gray-300" />
                        </div>
                      )}
                    </div>

                    {/* SPU 信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <h3 className="font-semibold text-gray-900 truncate">{a.spuName}</h3>
                        {allInThisSpuSelected && (
                          <span className="flex-shrink-0 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            已全选
                          </span>
                        )}
                        {selectedInThisSpu > 0 && !allInThisSpuSelected && (
                          <span className="flex-shrink-0 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                            已选 {selectedInThisSpu}/{images.length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        <span>{a.category || '-'}</span>
                        <span>·</span>
                        <span>{images.length} 张</span>
                        <span>·</span>
                        <span>{a.uploadedByName}</span>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={(e) => handleSpuDownload(e, a)}
                        disabled={downloadingId === a.id}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                      >
                        {downloadingId === a.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        下载全部
                      </button>
                      <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      </div>
                    </div>
                  </div>

                  {/* ── 展开区域：图片网格 ── */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/50">
                      {/* 展开区头部 */}
                      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                        <span className="text-xs text-gray-500">
                          {images.length} 张已通过图片
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectAllInSpu(a);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          {allInThisSpuSelected ? (
                            <><Square className="w-3 h-3" /> 取消全选</>
                          ) : (
                            <><CheckSquare className="w-3 h-3" /> 全选此SPU</>
                          )}
                        </button>
                      </div>

                      {/* 图片列表 */}
                      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {images.map((img) => {
                          const imgSelected = selectedImages.has(img.id);
                          return (
                            <div
                              key={img.id}
                              className={`bg-white rounded-lg border overflow-hidden transition-all group ${
                                imgSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              {/* 缩略图 */}
                              <div className="aspect-square bg-gray-100 relative">
                                <img
                                  src={`/api/images/${img.id}/file`}
                                  alt={img.filename}
                                  className="w-full h-full object-cover"
                                />

                                {/* 选择框 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleImageSelect(img.id);
                                  }}
                                  className={`absolute top-2 left-2 w-5 h-5 rounded flex items-center justify-center transition-all shadow-sm ${
                                    imgSelected
                                      ? 'bg-blue-600 text-white scale-100'
                                      : 'bg-white/80 text-gray-400 scale-75 opacity-0 group-hover:opacity-100 group-hover:scale-100'
                                  }`}
                                >
                                  {imgSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                </button>

                                {/* 单图下载按钮 */}
                                <button
                                  onClick={(e) => handleSingleDownload(e, img)}
                                  disabled={downloadingId === img.id}
                                  className="absolute top-2 right-2 p-1.5 bg-white/80 backdrop-blur-sm rounded-lg text-gray-600 hover:text-blue-600 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                                  title="下载此图片"
                                >
                                  {downloadingId === img.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>

                              {/* 文件信息 */}
                              <div className="p-2">
                                <p
                                  className="text-xs text-gray-700 truncate font-medium mb-0.5"
                                  title={img.filename}
                                >
                                  {img.filename}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {formatSize(img.fileSize)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors font-medium"
              >
                上一页
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                      p === page
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors font-medium"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </AuthLayout>
  );
}
