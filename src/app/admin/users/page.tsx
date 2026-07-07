'use client';

import { useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import AuthLayout from '@/components/AuthLayout';
import { Users, Trash2, Shield, UserCheck, Upload, UserPlus, FileSpreadsheet, Download, X, AlertCircle, CheckCircle2, Eye } from 'lucide-react';

interface UserItem {
  id: string;
  name: string;
  department: string;
  email: string;
  role: string;
  createdAt: string;
  _count: { uploadedSpus: number; reviews: number };
}

interface ParsedUser {
  name: string;
  department: string;
  role: string;
}

interface BatchResult {
  name: string;
  department: string;
  role: string;
  password: string;
  status: 'created' | 'skipped' | 'error';
  reason?: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const currentUser = session?.user as any;
  const isReviewer = currentUser?.role === 'REVIEWER';
  const isAdmin = currentUser?.role === 'ADMIN';

  useEffect(() => {
    if (session && !isAdmin && !isReviewer) {
      router.replace('/dashboard');
    }
  }, [session, isAdmin, isReviewer, router]);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');

  // ── 批量导入状态 ──
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchStep, setBatchStep] = useState<'upload' | 'preview' | 'creating' | 'result'>('upload');
  const [parsedUsers, setParsedUsers] = useState<ParsedUser[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchUsers = async () => {
    setLoading(true);
    const params = roleFilter ? `?role=${roleFilter}` : '';
    const res = await fetch(`/api/users${params}`);
    const data = await res.json();
    if (Array.isArray(data)) setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, [roleFilter]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除用户 "${name}" 吗？`)) return;
    await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchUsers();
  };

  // ── 批量导入：解析上传的表格 ──
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

        if (rows.length === 0) {
          setParseError('表格中没有数据');
          return;
        }

        // 智能匹配列名：支持 姓名/用户名/名字、部门、角色
        const headers = Object.keys(rows[0]);
        const nameKey = headers.find((h) => /姓名|用户名|名字|name/i.test(h)) || headers[0];
        const deptKey = headers.find((h) => /部门|department/i.test(h)) || '';
        const roleKey = headers.find((h) => /角色|role/i.test(h)) || '';

        const parsed = rows.map((row) => ({
          name: (row[nameKey] || '').trim(),
          department: deptKey ? (row[deptKey] || '未分配').trim() : '未分配',
          role: roleKey ? (row[roleKey] || 'UPLOADER').trim() : 'UPLOADER',
        }));

        const valid = parsed.filter((u) => u.name);
        if (valid.length === 0) {
          setParseError('未找到有效的姓名列，请确保表格第一列为姓名');
          return;
        }

        setParsedUsers(valid);
        setBatchStep('preview');
      } catch {
        setParseError('文件解析失败，请确认上传的是有效的 Excel/CSV 格式');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 批量导入：确认创建 ──
  const handleBatchCreate = async () => {
    setBatchStep('creating');
    const res = await fetch('/api/users/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: parsedUsers }),
    });
    const data = await res.json();
    setBatchResults(data.results || []);
    setBatchStep('result');
  };

  // ── 下载账号密码表（Excel） ──
  const handleDownloadResults = () => {
    const created = batchResults.filter((r) => r.status === 'created');
    if (created.length === 0) return;

    const exportData = created.map((r) => ({
      '姓名': r.name,
      '部门': r.department,
      '角色': r.role,
      '密码': r.password,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    // 设置列宽
    ws['!cols'] = [
      { wch: 12 },
      { wch: 18 },
      { wch: 10 },
      { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '账号列表');
    XLSX.writeFile(wb, `账号密码表_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── 关闭批量导入弹窗 ──
  const closeBatchModal = () => {
    setShowBatchModal(false);
    setBatchStep('upload');
    setParsedUsers([]);
    setBatchResults([]);
    setParseError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── 从结果直接跳回去列表 ──
  const handleBatchDone = () => {
    closeBatchModal();
    fetchUsers(); // 刷新用户列表
  };

  const roleBadge = (role: string) => {
    const map: Record<string, { label: string; className: string; Icon: any }> = {
      ADMIN: { label: '管理员', className: 'bg-purple-100 text-purple-700', Icon: Shield },
      REVIEWER: { label: '审核员', className: 'bg-blue-100 text-blue-700', Icon: UserCheck },
      UPLOADER: { label: '上传者', className: 'bg-gray-100 text-gray-700', Icon: Upload },
    };
    const item = map[role] || map.UPLOADER;
    const Icon = item.Icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${item.className}`}>
        <Icon className="w-3 h-3" />
        {item.label}
      </span>
    );
  };

  return (
    <AuthLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">用户管理</h2>
        <div className="flex gap-2 items-center">
          {(isAdmin || isReviewer) && (
            <>
              <Link
                href="/register"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                创建用户
              </Link>
              <button
                onClick={() => setShowBatchModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                批量导入
              </button>
            </>
          )}
          {['', 'ADMIN', 'REVIEWER', 'UPLOADER'].map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                roleFilter === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {r === '' ? '全部' : r === 'ADMIN' ? '管理员' : r === 'REVIEWER' ? '审核员' : '上传者'}
            </button>
          ))}
        </div>
      </div>

      {/* ── 用户列表 ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">暂无用户</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">部门</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">邮箱</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">角色</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">SPU任务</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">审核数</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">注册时间</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{user.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{user.department}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                    <td className="px-4 py-3">{roleBadge(user.role)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-center">{user._count.uploadedSpus}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-center">{user._count.reviews}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(user.id, user.name)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 hover:text-white bg-red-50 hover:bg-red-600 rounded-md transition-colors"
                          title="删除用户"
                        >
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 批量导入弹窗 ── */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 背景遮罩 */}
          <div className="absolute inset-0 bg-black/40" onClick={closeBatchModal} />
          {/* 弹窗 */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">批量导入用户</h3>
              <button onClick={closeBatchModal} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto p-6">
              {/* Step 1: 上传文件 */}
              {batchStep === 'upload' && (
                <div className="text-center py-8">
                  <FileSpreadsheet className="w-16 h-16 mx-auto text-green-400 mb-4" />
                  <p className="text-gray-700 font-medium mb-2">上传包含姓名和部门的表格</p>
                  <p className="text-gray-400 text-sm mb-6">
                    支持 .xlsx / .xls / .csv 格式，第一列应为「姓名」，第二列为「部门」
                  </p>
                  <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg cursor-pointer hover:bg-green-700 transition-colors font-medium">
                    <Upload className="w-4 h-4" />
                    选择文件
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  {parseError && (
                    <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {parseError}
                    </div>
                  )}
                  {/* 模板下载 */}
                  <div className="mt-6">
                    <button
                      onClick={() => {
                        const ws = XLSX.utils.json_to_sheet([
                          { '姓名': '张三', '部门': '视觉部', '角色': 'UPLOADER' },
                          { '姓名': '李四', '部门': '运营部', '角色': 'UPLOADER' },
                        ]);
                        ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 12 }];
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, '用户列表');
                        XLSX.writeFile(wb, '批量导入模板.xlsx');
                      }}
                      className="text-sm text-blue-600 hover:text-blue-700 underline underline-offset-2"
                    >
                      下载导入模板
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: 预览 */}
              {batchStep === 'preview' && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Eye className="w-5 h-5 text-blue-500" />
                    <span className="font-medium text-gray-700">
                      共解析 {parsedUsers.length} 条数据，请确认后点击创建
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">#</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">姓名</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">部门</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">角色</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {parsedUsers.slice(0, 50).map((u, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-4 py-2 text-gray-900 font-medium">{u.name}</td>
                            <td className="px-4 py-2 text-gray-600">{u.department}</td>
                            <td className="px-4 py-2">{roleBadge(u.role)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedUsers.length > 50 && (
                      <p className="px-4 py-2 text-xs text-gray-400">仅显示前 50 条，共 {parsedUsers.length} 条</p>
                    )}
                  </div>
                  <div className="flex gap-3 mt-5 justify-end">
                    <button
                      onClick={() => { setBatchStep('upload'); setParsedUsers([]); }}
                      className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      重新上传
                    </button>
                    <button
                      onClick={handleBatchCreate}
                      className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      确认创建 {parsedUsers.length} 个账号
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: 创建中 */}
              {batchStep === 'creating' && (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
                  <p className="text-gray-500">正在创建账号，请稍候...</p>
                </div>
              )}

              {/* Step 4: 结果 */}
              {batchStep === 'result' && (
                <div>
                  {/* 摘要 */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-green-50 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {batchResults.filter((r) => r.status === 'created').length}
                      </div>
                      <div className="text-xs text-green-500 mt-1">创建成功</div>
                    </div>
                    <div className="bg-yellow-50 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-yellow-600">
                        {batchResults.filter((r) => r.status === 'skipped').length}
                      </div>
                      <div className="text-xs text-yellow-500 mt-1">已存在跳过</div>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3 text-center">
                      <div className="text-2xl font-bold text-red-600">
                        {batchResults.filter((r) => r.status === 'error').length}
                      </div>
                      <div className="text-xs text-red-500 mt-1">失败</div>
                    </div>
                  </div>

                  {/* 结果表格 */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden max-h-60 overflow-auto mb-5">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">姓名</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">部门</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">角色</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">密码</th>
                          <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {batchResults.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900 font-medium">{r.name}</td>
                            <td className="px-4 py-2 text-gray-600">{r.department}</td>
                            <td className="px-4 py-2">{roleBadge(r.role)}</td>
                            <td className="px-4 py-2">
                              {r.status === 'created' ? (
                                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-700">
                                  {r.password}
                                </code>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {r.status === 'created' && (
                                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle2 className="w-3 h-3" />已创建
                                </span>
                              )}
                              {r.status === 'skipped' && (
                                <span className="inline-flex items-center gap-1 text-xs text-yellow-600" title={r.reason}>
                                  <AlertCircle className="w-3 h-3" />{r.reason}
                                </span>
                              )}
                              {r.status === 'error' && (
                                <span className="inline-flex items-center gap-1 text-xs text-red-600" title={r.reason}>
                                  <AlertCircle className="w-3 h-3" />{r.reason || '失败'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={closeBatchModal}
                      className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      关闭
                    </button>
                    {batchResults.some((r) => r.status === 'created') && (
                      <button
                        onClick={handleDownloadResults}
                        className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        下载账号密码表
                      </button>
                    )}
                    <button
                      onClick={handleBatchDone}
                      className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                      完成并刷新列表
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
