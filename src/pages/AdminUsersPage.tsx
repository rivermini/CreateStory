import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  createAdminUser,
  deleteAdminUser,
  getStoredAuthUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
  type AdminUserCreateRequest,
  type AdminUserUpdateRequest,
} from '../api/client';
import { Icon, appIcons } from '../components/Icon';
import { showToast } from '../components/Toast';
import type { ThemeMode } from '../types/theme';

interface AdminUsersPanelProps {
  themeMode: ThemeMode;
  embedded?: boolean;
}

type Role = 'admin' | 'user';

function emptyCreateForm(): AdminUserCreateRequest {
  return {
  email: '',
  password: '',
  role: 'user',
  is_active: true,
  };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function AdminUsersPanel({ themeMode, embedded = false }: AdminUsersPanelProps) {
  const isDark = themeMode === 'dark';
  const authUser = getStoredAuthUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<AdminUserCreateRequest>(() => emptyCreateForm());
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<AdminUserUpdateRequest>({});
  const [editPassword, setEditPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

  const activeAdmins = useMemo(() => users.filter(user => user.role === 'admin' && user.is_active).length, [users]);
  const canUseAdminTools = authUser?.role === 'admin';

  const loadUsers = async () => {
    setError('');
    setLoading(true);
    try {
      setUsers(await listAdminUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createAdminUser({ ...form, email: form.email.trim() });
      setForm(emptyCreateForm());
      setShowCreatePassword(false);
      await loadUsers();
      showToast('User created.', 'success', 1800, 'top-center');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create user.';
      setError(message);
      showToast(message, 'error', 2600, 'top-center');
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (user: AdminUser) => {
    if (user.id === authUser?.id) {
      showToast('You cannot edit your own admin account here.', 'warning', 2200, 'top-center');
      return;
    }
    setEditingUser(user);
    setEditPassword('');
    setShowEditPassword(false);
    setEditForm({
      email: user.email,
      role: user.role,
      is_active: user.is_active,
    });
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    setError('');
    const payload: AdminUserUpdateRequest = {
      email: editForm.email?.trim(),
      role: editForm.role,
      is_active: editForm.is_active,
    };
    if (editPassword.trim()) {
      payload.password = editPassword;
    }
    try {
      await updateAdminUser(editingUser.id, payload);
      setEditingUser(null);
      await loadUsers();
      showToast('User updated.', 'success', 1800, 'top-center');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user.';
      setError(message);
      showToast(message, 'error', 2600, 'top-center');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.id === authUser?.id) {
      showToast('You cannot delete your own admin account.', 'warning', 2200, 'top-center');
      setDeleteTarget(null);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await deleteAdminUser(deleteTarget.id);
      setDeleteTarget(null);
      await loadUsers();
      showToast('User deleted.', 'success', 1800, 'top-center');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete user.';
      setError(message);
      showToast(message, 'error', 2600, 'top-center');
    } finally {
      setSaving(false);
    }
  };

  const pageBackground = isDark
    ? 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 40%, #12101f 70%, #0e0f1c 100%)'
    : 'linear-gradient(135deg, #eef2ff 0%, #eef8f5 38%, #f8f0f4 72%, #f8fafc 100%)';

  if (!canUseAdminTools) {
    return (
      <div className={`min-h-screen relative overflow-hidden ${isDark ? 'dark' : 'light'}`} style={{ background: pageBackground }}>
        <div className="relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0">
          <main className="w-full xl:max-w-[68vw] mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <div className="lg-glass-deep px-6 py-5">
              <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                Admin
              </h1>
              <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Admin access is required.
              </p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`${embedded ? '' : 'min-h-screen relative overflow-hidden'} ${isDark ? 'dark' : 'light'}`} style={embedded ? undefined : { background: pageBackground }}>
      <div className={`${embedded ? '' : 'relative z-10 min-h-screen pb-20 lg:pb-0 pt-14 lg:pt-0'}`}>
        <main className="w-full 2xl:max-w-[78vw] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <div className="lg-glass-deep px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>
                Users
              </h1>
              <p className={`mt-1 text-sm sm:text-base ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                Manage application accounts
              </p>
            </div>
            <button
              type="button"
              onClick={loadUsers}
              disabled={loading}
              className={`h-10 px-4 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                isDark
                  ? 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1] disabled:text-white/25'
                  : 'bg-black/[0.05] text-black/65 hover:bg-black/[0.08] disabled:text-black/25'
              }`}
            >
              <Icon icon={appIcons.refresh} className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {error && (
            <div className={`flex items-center gap-3 p-4 rounded-xl text-sm ${isDark
              ? 'bg-red-900/20 border border-red-800/30 text-red-300'
              : 'bg-red-50 border border-red-200 text-red-600'
            }`}>
              <Icon icon={appIcons.info} className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}

          <section className="lg-glass p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-5">
              <div className={`p-2.5 rounded-xl ${isDark ? 'bg-white/[0.06] text-emerald-300' : 'bg-emerald-50 text-emerald-600'}`}>
                <Icon icon={appIcons.userAdd} className="w-5 h-5" />
              </div>
              <div>
                <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Create User</h2>
                <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>Add a login for this app.</p>
              </div>
            </div>

            <form
              onSubmit={handleCreate}
              autoComplete="off"
              className="grid grid-cols-1 md:grid-cols-[minmax(180px,1.5fr)_minmax(220px,1fr)_140px_140px_auto] gap-3 items-end"
            >
              <Field label="Email" isDark={isDark}>
                <input
                  type="email"
                  name="new-user-email"
                  autoComplete="off"
                  value={form.email}
                  onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))}
                  required
                  className={inputClass(isDark)}
                  placeholder="user@example.com"
                />
              </Field>
              <Field label="Password" isDark={isDark}>
                <PasswordInput
                  value={form.password}
                  onChange={value => setForm(prev => ({ ...prev, password: value }))}
                  visible={showCreatePassword}
                  onToggle={() => setShowCreatePassword(show => !show)}
                  isDark={isDark}
                  required
                  placeholder="At least 8 chars"
                  name="new-user-password"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Role" isDark={isDark}>
                <select
                  value={form.role}
                  onChange={event => setForm(prev => ({ ...prev, role: event.target.value as Role }))}
                  className={inputClass(isDark)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="Status" isDark={isDark}>
                <select
                  value={form.is_active ? 'active' : 'disabled'}
                  onChange={event => setForm(prev => ({ ...prev, is_active: event.target.value === 'active' }))}
                  className={inputClass(isDark)}
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
              <button
                type="submit"
                disabled={saving}
                className="h-11 px-5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Icon icon={appIcons.add} className="w-4 h-4" />
                Create
              </button>
            </form>
          </section>

          <section className="lg-glass overflow-hidden">
            <div className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className={`text-base font-semibold ${isDark ? 'text-white/90' : 'text-[rgba(0,0,0,0.85)]'}`}>Users</h2>
                <p className={`text-sm ${isDark ? 'text-white/40' : 'text-[rgba(0,0,0,0.4)]'}`}>
                  {users.length} total, {activeAdmins} active admin{activeAdmins === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            {loading ? (
              <div className={`px-6 py-12 flex items-center justify-center gap-3 ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                <Icon icon={appIcons.spinner} className="animate-spin h-5 w-5" />
                Loading users...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? 'bg-white/[0.03] text-white/45' : 'bg-black/[0.03] text-black/45'}>
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold">Email</th>
                      <th className="px-5 py-3 text-left font-semibold">Role</th>
                      <th className="px-5 py-3 text-left font-semibold">Status</th>
                      <th className="px-5 py-3 text-left font-semibold">Password</th>
                      <th className="px-5 py-3 text-left font-semibold">Created</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={isDark ? 'divide-y divide-white/[0.06]' : 'divide-y divide-black/[0.06]'}>
                    {users.map(user => {
                      const isCurrentUser = user.id === authUser?.id;
                      const isLastActiveAdmin = user.role === 'admin' && user.is_active && activeAdmins <= 1;
                      return (
                        <tr key={user.id} className={isDark ? 'text-white/75' : 'text-black/70'}>
                          <td className="px-5 py-4">
                            <div className="font-semibold truncate max-w-[260px]">{user.email}</div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-white/30' : 'text-black/35'}`}>{user.id}</div>
                          </td>
                          <td className="px-5 py-4">
                            <RoleBadge role={user.role} isDark={isDark} />
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge active={user.is_active} isDark={isDark} />
                          </td>
                          <td className={`px-5 py-4 ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">Encrypted</span>
                              <button
                                type="button"
                                onClick={() => beginEdit(user)}
                                disabled={isCurrentUser}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                  isCurrentUser
                                    ? isDark ? 'bg-white/[0.04] text-white/25 cursor-not-allowed' : 'bg-black/[0.04] text-black/25 cursor-not-allowed'
                                    : isDark ? 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]' : 'bg-black/[0.05] text-black/60 hover:bg-black/[0.08]'
                                }`}
                                title={isCurrentUser ? 'You cannot edit your own account here' : 'Reset password'}
                              >
                                Reset
                              </button>
                            </div>
                          </td>
                          <td className={`px-5 py-4 whitespace-nowrap ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                            {formatDate(user.created_at)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              {isCurrentUser && (
                                <span className={`px-2 py-1 rounded text-xs ${isDark ? 'bg-white/[0.06] text-white/45' : 'bg-black/[0.05] text-black/45'}`}>
                                  You
                                </span>
                              )}
                              {!isCurrentUser && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => beginEdit(user)}
                                    className={actionButtonClass(isDark)}
                                    title="Edit user"
                                  >
                                    <Icon icon={appIcons.edit} className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(user)}
                                    disabled={isLastActiveAdmin}
                                    className={`${actionButtonClass(isDark)} ${isLastActiveAdmin ? 'opacity-40 cursor-not-allowed' : isDark ? 'hover:text-red-300' : 'hover:text-red-600'}`}
                                    title={isLastActiveAdmin ? 'Cannot delete the last active admin' : 'Delete user'}
                                  >
                                    <Icon icon={appIcons.delete} className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>

      {editingUser && (
        <div className="lg-modal-overlay">
          <form onSubmit={handleUpdate} className="lg-glass-deep p-6 w-full max-w-lg space-y-5">
            <div>
              <h2 className={`text-xl font-bold ${isDark ? 'text-white/90' : 'text-black/85'}`}>Edit User</h2>
              <p className={`text-sm mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{editingUser.email}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Email" isDark={isDark}>
                <input
                  type="email"
                  value={editForm.email ?? ''}
                  onChange={event => setEditForm(prev => ({ ...prev, email: event.target.value }))}
                  required
                  className={inputClass(isDark)}
                />
              </Field>
              <Field label="New password" isDark={isDark}>
                <PasswordInput
                  value={editPassword}
                  onChange={setEditPassword}
                  visible={showEditPassword}
                  onToggle={() => setShowEditPassword(show => !show)}
                  isDark={isDark}
                  placeholder="Leave unchanged"
                  name="reset-user-password"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Role" isDark={isDark}>
                <select
                  value={editForm.role ?? editingUser.role}
                  onChange={event => setEditForm(prev => ({ ...prev, role: event.target.value as Role }))}
                  className={inputClass(isDark)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="Status" isDark={isDark}>
                <select
                  value={(editForm.is_active ?? editingUser.is_active) ? 'active' : 'disabled'}
                  onChange={event => setEditForm(prev => ({ ...prev, is_active: event.target.value === 'active' }))}
                  className={inputClass(isDark)}
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${isDark ? 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]' : 'bg-black/[0.05] text-black/60 hover:bg-black/[0.08]'}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 disabled:opacity-50"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="lg-modal-overlay">
          <div className="lg-glass-deep p-6 w-full max-w-md space-y-4">
            <div>
              <h2 className={`text-xl font-bold ${isDark ? 'text-white/90' : 'text-black/85'}`}>Delete User</h2>
              <p className={`text-sm mt-2 ${isDark ? 'text-white/45' : 'text-black/45'}`}>
                Delete {deleteTarget.email}? This also removes refresh tokens for that account.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${isDark ? 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]' : 'bg-black/[0.05] text-black/60 hover:bg-black/[0.08]'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/25 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, isDark, children }: { label: string; isDark: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className={`block text-sm mb-2 ${isDark ? 'text-white/45' : 'text-black/45'}`}>{label}</span>
      {children}
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  visible,
  onToggle,
  isDark,
  required = false,
  placeholder,
  name,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  isDark: boolean;
  required?: boolean;
  placeholder?: string;
  name?: string;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        name={name}
        onChange={event => onChange(event.target.value)}
        required={required}
        minLength={required || value ? 8 : undefined}
        autoComplete={autoComplete}
        className={`${inputClass(isDark)} pr-11`}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={onToggle}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors ${
          isDark ? 'text-white/45 hover:text-white/80 hover:bg-white/[0.08]' : 'text-black/45 hover:text-black/75 hover:bg-black/[0.06]'
        }`}
        title={visible ? 'Hide password' : 'Show password'}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <Icon icon={appIcons.eyeSlash} className="w-4 h-4" />
        ) : (
          <Icon icon={appIcons.eye} className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

function RoleBadge({ role, isDark }: { role: Role; isDark: boolean }) {
  const color = role === 'admin'
    ? isDark ? 'bg-indigo-500/12 text-indigo-200 border-indigo-400/25' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : isDark ? 'bg-white/[0.05] text-white/55 border-white/[0.08]' : 'bg-black/[0.04] text-black/55 border-black/10';
  return <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold uppercase border ${color}`}>{role}</span>;
}

function StatusBadge({ active, isDark }: { active: boolean; isDark: boolean }) {
  const color = active
    ? isDark ? 'bg-emerald-500/12 text-emerald-200 border-emerald-400/25' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : isDark ? 'bg-red-500/10 text-red-200 border-red-400/20' : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold border ${color}`}>{active ? 'Active' : 'Disabled'}</span>;
}

function inputClass(isDark: boolean): string {
  return `w-full h-11 px-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
    isDark
      ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder:text-white/25'
      : 'bg-black/[0.04] border-black/8 text-black/85 placeholder:text-black/30'
  }`;
}

function actionButtonClass(isDark: boolean): string {
  return `w-9 h-9 rounded-lg inline-flex items-center justify-center transition-colors ${
    isDark ? 'text-white/45 hover:text-white/80 hover:bg-white/[0.08]' : 'text-black/45 hover:text-black/75 hover:bg-black/[0.06]'
  }`;
}
