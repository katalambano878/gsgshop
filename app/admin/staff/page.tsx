'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminOnly from '@/components/admin/AdminOnly';
import { adminFetch, errorText } from '@/components/admin/adminFetch';

type StaffRole = 'admin' | 'staff';

type StaffMember = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: StaffRole;
  created_at: string;
  updated_at?: string;
  last_sign_in_at?: string | null;
  banned?: boolean;
};

type Counts = { total: number; admin: number; staff: number };

const ROLE_BADGE: Record<StaffRole, string> = {
  admin: 'bg-rose-100 text-rose-800 border-rose-200',
  staff: 'bg-blue-100 text-blue-800 border-blue-200',
};

const ROLE_OPTIONS: { value: StaffRole; label: string; help: string }[] = [
  { value: 'staff', label: 'Staff', help: 'Orders, till, products, customers, reviews, messages and the rest of the dashboard.' },
  { value: 'admin', label: 'Admin', help: 'Everything staff can do, plus staff accounts, delivery pricing, Meta & WhatsApp, modules and the SMS debugger.' },
];

const roleLabel = (r: string) => (r === 'admin' ? 'Admin' : r === 'staff' ? 'Staff' : 'Customer');

/** The same rule the server applies (lib/db/auth MIN_PASSWORD_LENGTH). */
const MIN_PASSWORD = 8;

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function AdminStaffPage() {
  return (
    <AdminOnly title="Staff">
      <StaffManager />
    </AdminOnly>
  );
}

function StaffManager() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | StaffRole>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState<StaffMember | null>(null);
  const [addForm, setAddForm] = useState({ full_name: '', email: '', password: '', role: 'staff' as StaffRole });
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', role: 'staff' as StaffRole });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await adminFetch<{ staff: StaffMember[]; counts: Counts; viewerId: string }>('/api/admin/staff');
    if (!res.ok) {
      setError(errorText(res.data, 'Could not load staff accounts.'));
    } else {
      setStaff(res.data.staff || []);
      setCounts(res.data.counts || null);
      setViewerId(res.data.viewerId || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (roleFilter !== 'all' && s.role !== roleFilter) return false;
      if (!q) return true;
      return [s.full_name, s.email, s.phone].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [staff, search, roleFilter]);

  const openAdd = () => {
    setAddForm({ full_name: '', email: '', password: '', role: 'staff' });
    setFormError('');
    setAddOpen(true);
  };

  const openEdit = (member: StaffMember) => {
    setEditForm({ full_name: member.full_name || '', phone: member.phone || '', role: member.role });
    setFormError('');
    setEditOpen(member);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (addForm.password && addForm.password.length < MIN_PASSWORD) {
      setFormError(`The password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch<{ staff: StaffMember; promoted?: boolean; message?: string }>('/api/admin/staff', {
        body: { ...addForm, email: addForm.email.trim(), full_name: addForm.full_name.trim() },
      });
      if (!res.ok) {
        setFormError(errorText(res.data, 'Could not add this staff member.'));
        return;
      }
      setAddOpen(false);
      setNotice(
        res.data.promoted
          ? `${addForm.email.trim()} now has ${roleLabel(addForm.role)} access. ${res.data.message || ''}`.trim()
          : `${addForm.email.trim()} was added as ${roleLabel(addForm.role)}. Give them the password in person or by phone; nothing is emailed.`
      );
      await loadStaff();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOpen) return;
    // Send only what changed, so editing a name never touches the role.
    const changes: Record<string, string> = {};
    if (editForm.full_name.trim() !== (editOpen.full_name || '')) changes.full_name = editForm.full_name.trim();
    if (editForm.phone.trim() !== (editOpen.phone || '')) changes.phone = editForm.phone.trim();
    if (editForm.role !== editOpen.role && editOpen.id !== viewerId) changes.role = editForm.role;
    if (Object.keys(changes).length === 0) {
      setEditOpen(null);
      return;
    }
    if (changes.role === 'staff' && !confirm(`Change ${editOpen.full_name || editOpen.email} from Admin to Staff? They lose access to the admin-only pages straight away.`)) return;
    setSaving(true);
    setFormError('');
    try {
      const res = await adminFetch(`/api/admin/staff/${editOpen.id}`, { method: 'PUT', body: changes });
      if (!res.ok) {
        setFormError(errorText(res.data, 'Could not save the changes.'));
        return;
      }
      setEditOpen(null);
      setNotice('Saved.');
      await loadStaff();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member: StaffMember) => {
    if (member.id === viewerId) return;
    const ok = window.confirm(
      `Remove dashboard access for ${member.full_name || member.email}?\n\nThey are signed out everywhere and can no longer open the dashboard. Their account and order history stay, as a customer account.`
    );
    if (!ok) return;
    setBusyId(member.id);
    setError('');
    setNotice('');
    const res = await adminFetch(`/api/admin/staff/${member.id}`, { method: 'DELETE' });
    setBusyId(null);
    if (!res.ok) {
      setError(errorText(res.data, 'Could not remove this staff member.'));
      return;
    }
    setNotice(`${member.full_name || member.email} no longer has dashboard access.`);
    await loadStaff();
  };

  const inputClass = 'w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Staff</h1>
          <p className="text-gray-600 mt-1">Who can open the dashboard, and whether they are staff or admin.</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors"
        >
          <i className="ri-user-add-line text-lg"></i>
          Add staff
        </button>
      </div>

      {counts && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold text-gray-900">{counts.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Admins</p>
            <p className="text-2xl font-bold text-rose-700">{counts.admin}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">Staff</p>
            <p className="text-2xl font-bold text-blue-700">{counts.staff}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or phone"
            aria-label="Search staff"
            className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {(['all', 'admin', 'staff'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={`px-4 py-2.5 text-sm font-semibold transition-colors ${roleFilter === key ? 'bg-blue-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {key === 'all' ? 'All' : roleLabel(key)}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><i className="ri-close-line"></i></button>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-loader-4-line animate-spin text-3xl text-blue-600"></i>
            <p className="mt-3">Loading staff...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-shield-user-line text-5xl text-gray-300"></i>
            <p className="mt-3 font-semibold text-gray-700">No staff found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Person</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase hidden md:table-cell">Last sign-in</th>
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase hidden lg:table-cell">Added</th>
                  <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {member.full_name || 'No name'}
                          {member.id === viewerId && <span className="ml-2 text-xs font-medium text-blue-700">(you)</span>}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{member.email}</p>
                        {member.phone && <p className="text-xs text-gray-400">{member.phone}</p>}
                        {member.banned && <p className="text-xs text-red-600 font-semibold">Sign-in blocked</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${ROLE_BADGE[member.role] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                        {roleLabel(member.role)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 hidden md:table-cell">{formatDate(member.last_sign_in_at)}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 hidden lg:table-cell">{formatDate(member.created_at)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(member)}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                          aria-label={`Edit ${member.full_name || member.email}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(member)}
                          disabled={busyId === member.id || member.id === viewerId}
                          title={member.id === viewerId ? 'You cannot remove your own access' : 'Remove dashboard access'}
                          aria-label={`Remove dashboard access for ${member.full_name || member.email}`}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                        >
                          {busyId === member.id ? 'Removing...' : 'Remove access'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setAddOpen(false)} />
          <form
            onSubmit={handleCreate}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-staff-title"
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h2 id="add-staff-title" className="text-xl font-bold text-gray-900">Add staff member</h2>
            <div>
              <label htmlFor="staff-name" className="block text-sm font-semibold text-gray-800 mb-1">Full name</label>
              <input id="staff-name" required value={addForm.full_name} onChange={(e) => setAddForm(f => ({ ...f, full_name: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label htmlFor="staff-email" className="block text-sm font-semibold text-gray-800 mb-1">Email (used to sign in)</label>
              <input id="staff-email" required type="email" autoComplete="off" value={addForm.email} onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label htmlFor="staff-password" className="block text-sm font-semibold text-gray-800 mb-1">Starting password</label>
              <input
                id="staff-password"
                type="text"
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                value={addForm.password}
                onChange={(e) => setAddForm(f => ({ ...f, password: e.target.value }))}
                className={inputClass}
              />
              <p className="text-xs text-gray-500 mt-1">
                At least {MIN_PASSWORD} characters. Nothing is emailed: give it to them in person or by phone. If the email already has a customer account, this is not used and they keep their own password.
              </p>
            </div>
            <fieldset>
              <legend className="block text-sm font-semibold text-gray-800 mb-2">Role</legend>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${addForm.role === opt.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                    <input type="radio" name="add-role" checked={addForm.role === opt.value} onChange={() => setAddForm(f => ({ ...f, role: opt.value }))} className="mt-1" />
                    <span>
                      <span className="block font-semibold text-gray-900">{opt.label}</span>
                      <span className="block text-xs text-gray-600">{opt.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {formError && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" disabled={saving} onClick={() => setAddOpen(false)} className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2.5 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : 'Add staff'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setEditOpen(null)} />
          <form
            onSubmit={handleEdit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-staff-title"
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h2 id="edit-staff-title" className="text-xl font-bold text-gray-900">Edit staff member</h2>
            <p className="text-sm text-gray-500">{editOpen.email}</p>
            <div>
              <label htmlFor="edit-staff-name" className="block text-sm font-semibold text-gray-800 mb-1">Full name</label>
              <input id="edit-staff-name" required value={editForm.full_name} onChange={(e) => setEditForm(f => ({ ...f, full_name: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label htmlFor="edit-staff-phone" className="block text-sm font-semibold text-gray-800 mb-1">Phone (optional)</label>
              <input id="edit-staff-phone" type="tel" value={editForm.phone} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} />
            </div>
            {editOpen.id === viewerId ? (
              <p className="text-sm text-gray-600">
                Role: <strong>{roleLabel(editOpen.role)}</strong>. You cannot change your own role; ask another admin.
              </p>
            ) : (
              <fieldset>
                <legend className="block text-sm font-semibold text-gray-800 mb-2">Role</legend>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map((opt) => (
                    <label key={opt.value} className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${editForm.role === opt.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                      <input type="radio" name="edit-role" checked={editForm.role === opt.value} onChange={() => setEditForm(f => ({ ...f, role: opt.value }))} className="mt-1" />
                      <span>
                        <span className="block font-semibold text-gray-900">{opt.label}</span>
                        <span className="block text-xs text-gray-600">{opt.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {formError && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" disabled={saving} onClick={() => setEditOpen(null)} className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2.5 rounded-lg bg-blue-700 text-white font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
