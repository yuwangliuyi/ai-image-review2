'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthLayout from '@/components/AuthLayout';
import { Users, Trash2, Shield, UserCheck, Upload, UserPlus } from 'lucide-react';

interface UserItem {
  id: string;
  name: string;
  department: string;
  email: string;
  role: string;
  createdAt: string;
  _count: { uploadedSpus: number; reviews: number };
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const currentUser = session?.user as any;
  const isReviewer = currentUser?.role === 'REVIEWER';
  const isAdmin = currentUser?.role === 'ADMIN';

  // 权限守卫：仅 ADMIN 和审核员可访问
  useEffect(() => {
    if (session && !isAdmin && !isReviewer) {
      router.replace('/dashboard');
    }
  }, [session, isAdmin, isReviewer, router]);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');

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
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              创建用户
            </Link>
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
    </AuthLayout>
  );
}
