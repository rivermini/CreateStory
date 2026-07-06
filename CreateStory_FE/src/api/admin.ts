import { apiFetch } from './client';
import type {
  AdminUser,
  AdminUserCreateRequest,
  AdminUserUpdateRequest,
} from './types';

export async function listAdminUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>('/api/admin/users');
}

export async function createAdminUser(request: AdminUserCreateRequest): Promise<AdminUser> {
  return apiFetch<AdminUser>('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function updateAdminUser(userId: string, request: AdminUserUpdateRequest): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export async function deleteAdminUser(userId: string): Promise<{ deleted: boolean; id: string }> {
  return apiFetch<{ deleted: boolean; id: string }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
