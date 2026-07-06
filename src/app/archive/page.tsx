'use client';

import { useEffect, useState } from 'react';
import AuthLayout from '@/components/AuthLayout';
import { Archive, Download, Package, Image } from 'lucide-react';

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
  spu: { images: { id: string; storedPath: string; filename: string }[] };
}

export default function ArchivePage() {
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/archives?page=${page}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        setArchives(data.archives || []);
        setTotalPages(data.totalPages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page]);

  const handleDownload = async (archiveItem: ArchiveItem) => {
    setDownloadingId(archiveItem.id);
    try {
      const res = await fetch(`/api/archives/${archiveItem.id}/download`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '下载失败' }));
        alert(data.error || '下载失败');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = `${archiveItem.spuName}.zip`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('下载失败');
    }
    setDownloadingId(null);
  };

  const formatDate = (d: string) => new Date(d).toLocaleString('zh-CN');

  return (
    <AuthLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">归档管理</h2>
        <span className="text-sm text-gray-500">审核通过的SPU将自动归档</span>
      </div>

      {/* Windows 用户解压提示 */}
      <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>
          <strong>Windows 用户注意：</strong>
          下载的 ZIP 包请使用 <a href="https://www.7-zip.org/" target="_blank" className="underline font-medium">7-Zip</a> 或 <a href="https://www.bandisoft.com/bandizip/" target="_blank" className="underline font-medium">Bandizip</a> 解压，
          系统自带解压器可能出现中文文件名乱码。
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : archives.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Archive className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">暂无归档的SPU任务</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archives.map((a) => (
              <div key={a.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden group">
                {/* Preview - first image */}
                <div className="h-40 bg-gray-100 relative">
                  {a.spu?.images?.[0] ? (
                    <img
                      src={`/api/images/${a.spu.images[0].id}/file`}
                      alt={a.spuName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Image className="w-10 h-10 text-gray-300" />
                    </div>
                  )}
                  <button
                    onClick={() => handleDownload(a)}
                    disabled={downloadingId === a.id}
                    className="absolute top-2 right-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                    title="下载ZIP压缩包"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloadingId === a.id ? '打包中...' : '下载'}
                  </button>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-blue-500" />
                    <h3 className="font-semibold text-gray-900 truncate">{a.spuName}</h3>
                  </div>
                  {/* 归档路径 */}
                  <div className="mb-2">
                    {[a.category, a.countryStyle, a.shopName].filter(Boolean).length > 0 && (
                      <p className="text-xs text-gray-400 truncate" title={`归档/${[a.category, a.countryStyle, a.spuName, a.shopName].filter(Boolean).join("/")}`}>
                        归档/{[a.category, a.countryStyle, a.spuName, a.shopName].filter(Boolean).join("/")}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    {a.imageCount} 张图片
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 pt-3">
                    <div>
                      <span>{a.uploadedByName}</span>
                      <span className="mx-1">·</span>
                      <span>{a.department}</span>
                    </div>
                    <span>{formatDate(a.archivedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-600">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50"
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
