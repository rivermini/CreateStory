import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createAdminUser,
  deleteAdminUser,
  getStoredAuthUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
  type AdminUserCreateRequest,
  type AdminUserUpdateRequest,
} from '../../api';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { showToast } from '../../components/Shared/Toast';
import type { ThemeMode } from '../../types/theme';

interface AdminUsersPanelProps {
  readonly themeMode: ThemeMode;
  readonly embedded?: boolean;
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

  const activeAdmins = useMemo(
    () => users.filter((user) => user.role === 'admin' && user.is_active).length,
    [users],
  );
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
    (async () => {
      setError('');
      setLoading(true);
      try {
        setUsers(await listAdminUsers());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreate = async (event: React.SyntheticEvent) => {
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

  const handleUpdate = async (event: React.SyntheticEvent) => {
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
    ? 'linear-gradient(180deg, #191919 0%, #171717 100%)'
    : 'linear-gradient(180deg, #fbfbfa 0%, #f7f6f3 100%)';
  const pageText = isDark ? 'rgba(255,255,255,0.92)' : '#37352f';
  const secondaryText = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.62)';
  const tertiaryText = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(55,53,47,0.42)';
  const panelBackground = isDark ? '#202020' : '#ffffff';
  const panelBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.12)';
  const mutedSurface = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(55,53,47,0.05)';
  const headerShell = embedded ? '' : 'mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8';

  if (!canUseAdminTools) {
    return (
      <div className={`${isDark ? 'dark' : 'light'} min-h-screen`} style={{ background: pageBackground }}>
        <div className={embedded ? 'p-0' : headerShell}>
          <main className="space-y-5">
            <section
              className="rounded-2xl border px-5 py-5 sm:px-6"
              style={{ background: panelBackground, borderColor: panelBorder }}
            >
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Admin
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                Access required
              </h1>
              <p className="mt-2 text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                Admin access is required.
              </p>
            </section>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isDark ? 'dark' : 'light'} ${embedded ? '' : 'min-h-screen'}`} style={embedded ? undefined : { background: pageBackground }}>
      <div className={embedded ? 'space-y-5' : headerShell}>
        <main className="space-y-5">
          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                  Admin
                </div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: pageText }}>
                  Users
                </h1>
                <p className="max-w-3xl text-sm leading-6 sm:text-[15px]" style={{ color: secondaryText }}>
                  Manage application accounts, roles, passwords, and activation state.
                </p>
              </div>

              <button
                type="button"
                onClick={loadUsers}
                disabled={loading}
                className="rounded-md border px-3 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon icon={appIcons.refresh} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </span>
              </button>
            </div>
          </section>

          {error && (
            <section
              className="rounded-2xl border px-5 py-4 text-sm sm:px-6"
              style={{ background: panelBackground, borderColor: '#dc2626', color: isDark ? '#f87171' : '#dc2626' }}
            >
              <div className="flex items-center gap-3">
                <Icon icon={appIcons.info} className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            </section>
          )}

          <section
            className="rounded-2xl border px-5 py-5 sm:px-6"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div className="mb-5 space-y-1">
              <div className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: tertiaryText }}>
                Create
              </div>
              <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                Add user
              </h2>
              <p className="text-sm" style={{ color: secondaryText }}>
                Create a new login for this app.
              </p>
            </div>

            <form
              onSubmit={handleCreate}
              autoComplete="off"
              className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(180px,1.5fr)_minmax(220px,1fr)_140px_140px_auto] md:items-end"
            >
              <Field label="Email" secondaryText={secondaryText}>
                <input
                  type="email"
                  name="new-user-email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  required
                  className={inputClass(isDark)}
                  placeholder="user@example.com"
                />
              </Field>
              <Field label="Password" secondaryText={secondaryText}>
                <PasswordInput
                  value={form.password}
                  onChange={(value) => setForm((prev) => ({ ...prev, password: value }))}
                  visible={showCreatePassword}
                  onToggle={() => setShowCreatePassword((show) => !show)}
                  isDark={isDark}
                  required
                  placeholder="At least 8 chars"
                  name="new-user-password"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Role" secondaryText={secondaryText}>
                <select
                  value={form.role}
                  onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as Role }))}
                  className={inputClass(isDark)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="Status" secondaryText={secondaryText}>
                <select
                  value={form.is_active ? 'active' : 'disabled'}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.value === 'active' }))}
                  className={inputClass(isDark)}
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity"
                style={{ background: '#059669', opacity: saving ? 0.6 : 1, minHeight: 44 }}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon icon={appIcons.add} className="h-4 w-4" />
                  Create
                </span>
              </button>
            </form>
          </section>

          <section
            className="overflow-hidden rounded-2xl border"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div
              className="flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              style={{ borderColor: panelBorder }}
            >
              <div>
                <h2 className="text-lg font-semibold" style={{ color: pageText }}>
                  Users
                </h2>
                <p className="text-sm" style={{ color: secondaryText }}>
                  {users.length} total, {activeAdmins} active admin{activeAdmins === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="px-6 py-12 text-sm" style={{ color: secondaryText }}>
                <div className="flex items-center justify-center gap-3">
                  <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin" />
                  Loading users…
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ background: mutedSurface, color: tertiaryText }}>
                    <tr>
                      <th className="px-5 py-3 text-left font-medium sm:px-6">Email</th>
                      <th className="px-5 py-3 text-left font-medium">Role</th>
                      <th className="px-5 py-3 text-left font-medium">Status</th>
                      <th className="px-5 py-3 text-left font-medium">Password</th>
                      <th className="px-5 py-3 text-left font-medium">Created</th>
                      <th className="px-5 py-3 text-right font-medium sm:px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user, index) => {
                      const isCurrentUser = user.id === authUser?.id;
                      const isLastActiveAdmin = user.role === 'admin' && user.is_active && activeAdmins <= 1;
                      return (
                        <tr
                          key={user.id}
                          style={{
                            borderTop: index === 0 ? 'none' : `1px solid ${panelBorder}`,
                            color: pageText,
                          }}
                        >
                          <td className="px-5 py-4 sm:px-6">
                            <div className="max-w-[260px] truncate font-medium">{user.email}</div>
                            <div className="mt-1 text-xs" style={{ color: tertiaryText }}>{user.id}</div>
                          </td>
                          <td className="px-5 py-4">
                            <RoleBadge role={user.role} isDark={isDark} />
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge active={user.is_active} isDark={isDark} />
                          </td>
                          <td className="px-5 py-4" style={{ color: secondaryText }}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">Encrypted</span>
                              <button
                                type="button"
                                onClick={() => beginEdit(user)}
                                disabled={isCurrentUser}
                                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                                  isCurrentUser
                                    ? isDark
                                      ? 'bg-white/[0.04] text-white/25 cursor-not-allowed'
                                      : 'bg-black/[0.04] text-black/25 cursor-not-allowed'
                                    : isDark
                                      ? 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'
                                      : 'bg-black/[0.05] text-black/60 hover:bg-black/[0.08]'
                                }`}
                                title={isCurrentUser ? 'You cannot edit your own account here' : 'Reset password'}
                              >
                                Reset
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap" style={{ color: secondaryText }}>
                            {formatDate(user.created_at)}
                          </td>
                          <td className="px-5 py-4 sm:px-6">
                            <div className="flex items-center justify-end gap-2">
                              {isCurrentUser && (
                                <span
                                  className="rounded-md px-2 py-1 text-xs"
                                  style={{ background: mutedSurface, color: secondaryText }}
                                >
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
                                    <Icon icon={appIcons.edit} className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(user)}
                                    disabled={isLastActiveAdmin}
                                    className={`${actionButtonClass(isDark)} ${isLastActiveAdmin ? 'opacity-40 cursor-not-allowed' : isDark ? 'hover:text-red-300' : 'hover:text-red-600'}`}
                                    title={isLastActiveAdmin ? 'Cannot delete the last active admin' : 'Delete user'}
                                  >
                                    <Icon icon={appIcons.delete} className="h-4 w-4" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form
            onSubmit={handleUpdate}
            className="w-full max-w-lg rounded-2xl border p-6 space-y-5"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div>
              <h2 className="text-xl font-semibold" style={{ color: pageText }}>Edit user</h2>
              <p className="mt-1 text-sm" style={{ color: secondaryText }}>{editingUser.email}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Email" secondaryText={secondaryText}>
                <input
                  type="email"
                  value={editForm.email ?? ''}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
                  required
                  className={inputClass(isDark)}
                />
              </Field>
              <Field label="New password" secondaryText={secondaryText}>
                <PasswordInput
                  value={editPassword}
                  onChange={setEditPassword}
                  visible={showEditPassword}
                  onToggle={() => setShowEditPassword((show) => !show)}
                  isDark={isDark}
                  placeholder="Leave unchanged"
                  name="reset-user-password"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Role" secondaryText={secondaryText}>
                <select
                  value={editForm.role ?? editingUser.role}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, role: event.target.value as Role }))}
                  className={inputClass(isDark)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="Status" secondaryText={secondaryText}>
                <select
                  value={(editForm.is_active ?? editingUser.is_active) ? 'active' : 'disabled'}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, is_active: event.target.value === 'active' }))}
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
                className="rounded-md border px-4 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity"
                style={{ background: '#4f46e5', opacity: saving ? 0.6 : 1 }}
              >
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-md rounded-2xl border p-6 space-y-4"
            style={{ background: panelBackground, borderColor: panelBorder }}
          >
            <div>
              <h2 className="text-xl font-semibold" style={{ color: pageText }}>Delete user</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: secondaryText }}>
                Delete {deleteTarget.email}? This also removes refresh tokens for that account.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border px-4 py-2 text-sm transition-colors"
                style={{ borderColor: panelBorder, background: mutedSurface, color: secondaryText }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity"
                style={{ background: '#dc2626', opacity: saving ? 0.6 : 1 }}
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

function Field({ label, secondaryText, children }: { readonly label: string; readonly secondaryText: string; readonly children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm" style={{ color: secondaryText }}>{label}</span>
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
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly visible: boolean;
  readonly onToggle: () => void;
  readonly isDark: boolean;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly name?: string;
  readonly autoComplete?: string;
}) {
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        minLength={required || value ? 8 : undefined}
        autoComplete={autoComplete}
        className={`${inputClass(isDark)} pr-11`}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={onToggle}
        className={`absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md transition-colors ${
          isDark ? 'text-white/45 hover:text-white/80 hover:bg-white/[0.08]' : 'text-black/45 hover:text-black/75 hover:bg-black/[0.06]'
        }`}
        title={visible ? 'Hide password' : 'Show password'}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <Icon icon={appIcons.eyeSlash} className="h-4 w-4" />
        ) : (
          <Icon icon={appIcons.eye} className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function RoleBadge({ role, isDark }: { readonly role: Role; readonly isDark: boolean }) {
  const color = role === 'admin'
    ? isDark ? 'bg-indigo-500/12 text-indigo-200 border-indigo-400/25' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : isDark ? 'bg-white/[0.05] text-white/55 border-white/[0.08]' : 'bg-black/[0.04] text-black/55 border-black/10';
  return <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium uppercase border ${color}`}>{role}</span>;
}

function StatusBadge({ active, isDark }: { readonly active: boolean; readonly isDark: boolean }) {
  const color = active
    ? isDark ? 'bg-emerald-500/12 text-emerald-200 border-emerald-400/25' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : isDark ? 'bg-red-500/10 text-red-200 border-red-400/20' : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium border ${color}`}>{active ? 'Active' : 'Disabled'}</span>;
}

function inputClass(isDark: boolean): string {
  return `h-11 w-full rounded-md border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
    isDark
      ? 'bg-white/[0.05] border-white/[0.08] text-white/90 placeholder:text-white/25'
      : 'bg-white border-[rgba(55,53,47,0.16)] text-[rgba(55,53,47,0.92)] placeholder:text-[rgba(55,53,47,0.35)]'
  }`;
}

function actionButtonClass(isDark: boolean): string {
  return `inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
    isDark ? 'text-white/45 hover:text-white/80 hover:bg-white/[0.08]' : 'text-black/45 hover:text-black/75 hover:bg-black/[0.06]'
  }`;
}
