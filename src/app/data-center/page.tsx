'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import AuthLayout from '@/components/AuthLayout';
import {
  Package, Image, ClipboardList, Search, ChevronLeft, ChevronRight, Download
} from 'lucide-react';

const TABS = [
  { key: 'spus', label: 'SPU 任务', icon: Package },
  { key: 'images', label: '图片列表', icon: Image },
  { key: 'reviews', label: '审核记录', icon: ClipboardList },
];

const PAGE_SIZE = 20;

export default function DataCenterPage() {
  const { data: session } = useSession();
  const currentUser = session?.user as any;
  const canExport = currentUser?.role === 'ADMIN' || currentUser?.role === 'REVIEWER';

  const [tab, setTab] = useState('spus');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/data-center/export');
      if (res.status === 403) {
        alert('无权限，仅管理员和审核员可导出数据');
        return;
      }
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AI图片审核数据总表_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('导出失败，请重试');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter !== 'ALL') params.set('status', statusFilter);

    fetch(`/api/data-center/${tab}?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tab, page, search, statusFilter]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-amber-100 text-amber-700',
      APPROVED: 'bg-green-100 text-green-700',
      REJECTED: 'bg-red-100 text-red-700',
    };
    const label: Record<string, string> = {
      PENDING: '待审核',
      APPROVED: '已通过',
      REJECTED: '已驳回',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
        {label[status] || status}
      </span>
    );
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <AuthLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">数据中心</h2>
        {canExport && (
          <button
            onClick={handleExport}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
          >
            <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
            {downloading ? '导出中...' : '导出全部数据'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); setSearch(''); setStatusFilter('ALL'); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={tab === 'spus' ? '搜索 SPU 名称...' : tab === 'images' ? '搜索文件名...' : '搜索审核人...'}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="ALL">全部状态</option>
          <option value="PENDING">待审核</option>
          <option value="APPROVED">已通过</option>
          <option value="REJECTED">已驳回</option>
        </select>

        {data && (
          <span className="text-sm text-gray-500">
            共 {data.total} 条记录
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">暂无数据</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  {tab === 'spus' && (
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">SPU 名称</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">品类</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">店铺</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">部门</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">上传者</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">图片数</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">通过/驳回</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">创建时间</th>
                    </tr>
                  )}
                  {tab === 'images' && (
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">文件名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">所属 SPU</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">上传者</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">大小</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">状态</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">上传时间</th>
                    </tr>
                  )}
                  {tab === 'reviews' && (
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">图片</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">SPU</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">审核人</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">操作</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">备注</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">时间</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tab === 'spus' &&
                    data.items.map((spu: any) => (
                      <tr key={spu.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{spu.name}</td>
                        <td className="px-4 py-3 text-gray-600">{spu.category || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{spu.shopName || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{spu.department || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{spu.uploadedBy?.name || '-'}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{spu._count?.images || 0}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-green-600 font-medium">{spu._approvedCount ?? 0}</span>
                          <span className="text-gray-400 mx-1">/</span>
                          <span className="text-red-600 font-medium">{spu._rejectedCount ?? 0}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{new Date(spu.createdAt).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  {tab === 'images' &&
                    data.items.map((img: any) => (
                      <tr key={img.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" title={img.filename}>
                          {img.filename}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{img.spu?.name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{img.uploadedBy?.name || '-'}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{formatSize(img.fileSize)}</td>
                        <td className="px-4 py-3 text-center">{statusBadge(img.status)}</td>
                        <td className="px-4 py-3 text-gray-500">{new Date(img.createdAt).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  {tab === 'reviews' &&
                    data.items.map((r: any) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" title={r.image?.filename}>
                          {r.image?.filename || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.image?.spu?.name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{r.reviewer?.name || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          {r.action === 'APPROVED' ? (
                            <span className="text-green-600 font-medium">通过</span>
                          ) : (
                            <span className="text-red-600 font-medium">驳回</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate" title={r.comment || ''}>
                          {r.comment || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
              <span className="text-sm text-gray-500">
                第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded text-sm border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded text-sm border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
