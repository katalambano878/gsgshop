'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadErrorText } from '@/components/admin/uploadError';

export default function AdminCategoriesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('all');

  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // In add mode the slug follows the name until someone types in the slug field.
  const slugTouched = useRef(false);

  // Delete dialog
  const [deleting, setDeleting] = useState<{ category: any; products: number; children: number } | null>(null);
  const [moveTo, setMoveTo] = useState<string>('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    image_url: '',
    parent_id: '' as string | null,
    featured: false,
    status: 'active',
    position: '0'
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('position', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      if (data) setCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (category: any) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || '',
      image_url: category.image_url || '',
      parent_id: category.parent_id || '',
      featured: category.metadata?.featured || false,
      status: category.status,
      position: String(category.position ?? 0)
    });
    slugTouched.current = true;
    setShowEditModal(true);
  };

  /** Ids of every category below `id` (children, grandchildren, ...). */
  const descendantIds = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of categories) {
        if (c.parent_id === cur && !out.has(c.id)) {
          out.add(c.id);
          stack.push(c.id);
        }
      }
    }
    return out;
  };

  const handleDelete = async (category: any) => {
    setDeleteError('');
    try {
      const [{ count: productCount, error: pErr }, { count: childCount, error: cErr }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('category_id', category.id),
        supabase.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', category.id),
      ]);
      if (pErr) throw pErr;
      if (cErr) throw cErr;
      setMoveTo(category.parent_id || '');
      setDeleting({ category, products: productCount || 0, children: childCount || 0 });
    } catch (err: any) {
      alert('Could not check whether the category is in use: ' + (err?.message || 'unknown error'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { category, products, children } = deleting;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      // The foreign keys have no ON DELETE rule, so move things out first or
      // the delete fails.
      if (products) {
        const { error } = await supabase.from('products').update({ category_id: moveTo || null }).eq('category_id', category.id);
        if (error) throw error;
      }
      if (children) {
        // Subcategories move up to this category's own parent.
        const { error } = await supabase.from('categories').update({ parent_id: category.parent_id || null }).eq('parent_id', category.id);
        if (error) throw error;
      }
      const { error } = await supabase.from('categories').delete().eq('id', category.id);
      if (error) throw error;
      setDeleting(null);
      fetchCategories();
    } catch (err: any) {
      setDeleteError('Category not deleted: ' + (err?.message || 'unknown error'));
      fetchCategories();
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;

      setUploading(true);
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
      if (file.size > 5 * 1024 * 1024) throw new Error('The image is larger than 5 MB.');
      const fileName = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(fileExt || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const filePath = `${fileName}`;

      // Upload to 'products' bucket for simplicity, or create a 'categories' bucket
      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('products')
        .getPublicUrl(filePath);

      setFormData({ ...formData, image_url: publicUrl });

    } catch (error: any) {
      alert('Image not uploaded: ' + uploadErrorText(error));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.slug) {
      alert('Name and Slug are required');
      return;
    }

    const slug = formData.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!slug) {
      alert('The slug needs at least one letter or number.');
      return;
    }
    const position = parseInt(formData.position, 10);
    if (!Number.isFinite(position) || String(position) !== formData.position.trim()) {
      alert('Position must be a whole number (lower numbers are shown first).');
      return;
    }

    const parentId = formData.parent_id || null;
    if (showEditModal && editingCategory && parentId) {
      // A category cannot sit under itself or under one of its own subcategories.
      if (parentId === editingCategory.id || descendantIds(editingCategory.id).has(parentId)) {
        alert('That parent is inside this category, so the two would contain each other. Choose a different parent.');
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name.trim(),
        slug,
        description: formData.description,
        image_url: formData.image_url,
        parent_id: parentId,
        status: formData.status,
        position,
        metadata: { featured: formData.featured }
      };

      if (showEditModal && editingCategory) {
        // Keep every other metadata key and only change `featured`, merged
        // with the latest stored metadata, not the copy loaded with the list.
        const { data: current, error: readErr } = await supabase
          .from('categories').select('metadata').eq('id', editingCategory.id).single();
        if (readErr) throw readErr;
        payload.metadata = { ...(current?.metadata || {}), featured: formData.featured };
        payload.updated_at = new Date().toISOString();
        const { error } = await supabase
          .from('categories')
          .update(payload)
          .eq('id', editingCategory.id);
        if (error) throw error;
        alert('Category updated');
      } else {
        const { error } = await supabase
          .from('categories')
          .insert([payload]);
        if (error) throw error;
        alert('Category created');
      }

      setShowAddModal(false);
      setShowEditModal(false);
      setEditingCategory(null);
      setFormData({ name: '', slug: '', description: '', image_url: '', parent_id: '', featured: false, status: 'active', position: '0' });
      fetchCategories();

    } catch (err: any) {
      const msg = err?.message || 'unknown error';
      alert(/categories_slug_key|duplicate key/i.test(msg)
        ? 'Another category already uses that slug. Change the slug.'
        : 'Category not saved: ' + msg);
    } finally {
      setSaving(false);
    }
  };

  // Auto-generate slug from the name, only until the slug is typed by hand.
  useEffect(() => {
    if (showAddModal && !editingCategory && !slugTouched.current) {
      setFormData(prev => ({
        ...prev,
        slug: prev.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
      }));
    }
  }, [formData.name, showAddModal, editingCategory]);


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Categories</h1>
          <p className="text-gray-600 mt-1">Organize your products into categories</p>
        </div>
        <button
          onClick={() => {
            setEditingCategory(null);
            setFormData({ name: '', slug: '', description: '', image_url: '', parent_id: '', featured: false, status: 'active', position: String(categories.length) });
            slugTouched.current = false;
            setShowAddModal(true);
          }}
          className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line mr-2"></i>
          Add Category
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Categories</p>
          <p className="text-2xl font-bold text-gray-900">{categories.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-2xl font-bold text-blue-700">{categories.filter(c => c.status === 'active').length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Featured</p>
          <p className="text-2xl font-bold text-blue-700">{categories.filter(c => c.metadata?.featured).length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Category</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Slug</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Parent</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Position</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Featured</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">Loading categories...</td></tr>
              ) : categories.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">No categories found. Create one to get started!</td></tr>
              ) : (
                categories.map((category) => (
                  <tr key={category.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                          {category.image_url ? (
                            <img src={category.image_url} alt={category.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <i className="ri-image-line text-2xl"></i>
                            </div>
                          )}
                        </div>
                        <span className="font-semibold text-gray-900">{category.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm font-mono">{category.slug}</td>
                    <td className="py-4 px-4 text-sm text-gray-600">
                      {categories.find(c => c.id === category.parent_id)?.name || '-'}
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600">{category.position ?? 0}</td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap capitalize ${category.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                        {category.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      {category.metadata?.featured ? (
                        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold whitespace-nowrap">
                          Featured
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEdit(category)}
                          aria-label={`Edit ${category.name}`}
                          title="Edit category"
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-edit-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(category)}
                          aria-label={`Delete ${category.name}`}
                          title="Delete category"
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-900">
                {showAddModal ? 'Add New Category' : 'Edit Category'}
              </h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                  setEditingCategory(null);
                }}
                aria-label="Close"
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-2xl w-6 h-6 flex items-center justify-center"></i>
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Category Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter category name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Parent Category (Optional)
                  </label>
                  <select
                    value={formData.parent_id || ''}
                    onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">None (Top Level)</option>
                    {categories
                      // Not itself and not one of its own subcategories (that would make a loop).
                      .filter(c => !editingCategory || (c.id !== editingCategory.id && !descendantIds(editingCategory.id).has(c.id)))
                      .map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  URL Slug *
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => { slugTouched.current = true; setFormData({ ...formData, slug: e.target.value }); }}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="category-url-slug"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Description
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Brief description of this category..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Category Image
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-700 hover:bg-blue-50 transition-colors relative">
                  {uploading ? (
                    <div className="flex flex-col items-center">
                      <i className="ri-loader-4-line animate-spin text-3xl mb-2 text-blue-700"></i>
                      <span className="text-sm font-medium text-gray-600">Uploading...</span>
                    </div>
                  ) : formData.image_url ? (
                    <div className="relative group">
                      <img src={formData.image_url} alt="Category" className="h-40 mx-auto object-contain rounded-lg shadow-sm" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg">
                        <label className="cursor-pointer bg-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-gray-100">
                          Change Image
                          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer block">
                      <i className="ri-upload-cloud-line text-4xl text-gray-400 mb-2 w-10 h-10 flex items-center justify-center mx-auto"></i>
                      <p className="text-gray-700 font-medium">Click to upload image</p>
                      <p className="text-sm text-gray-500 mt-1">Square (1:1) Recommended (e.g., 800x800px)</p>
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="cat-position" className="block text-sm font-semibold text-gray-900 mb-2">Position</label>
                <input
                  id="cat-position"
                  type="number"
                  step={1}
                  inputMode="numeric"
                  value={formData.position}
                  onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  className="w-40 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Lower numbers are listed first.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="flex items-center space-x-3 mt-6">
                  <input
                    id="cat-featured"
                    type="checkbox"
                    checked={formData.featured}
                    onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
                    className="w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                  <label htmlFor="cat-featured" className="text-gray-900 font-medium">
                    Feature on homepage
                  </label>
                </div>
              </div>

            </div>

            <div className="p-6 border-t border-gray-200 flex items-center justify-end space-x-3 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                  setEditingCategory(null);
                }}
                disabled={saving}
                className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || uploading}
                className={`px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center ${saving ? 'opacity-70' : ''}`}
              >
                {saving && <i className="ri-loader-4-line animate-spin mr-2"></i>}
                {showAddModal ? 'Add Category' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !deleteBusy && setDeleting(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="cat-delete-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="cat-delete-title" className="text-xl font-bold text-gray-900 mb-2">Delete &quot;{deleting.category.name}&quot;?</h2>
            <p className="text-sm text-gray-600 mb-4">This cannot be undone.</p>
            {deleting.products === 0 && deleting.children === 0 ? (
              <p className="text-sm text-gray-700 mb-4">No products or subcategories use it.</p>
            ) : (
              <div className="space-y-4 mb-4 text-sm text-gray-700">
                <p>This category is still in use, so it is emptied first:</p>
                {deleting.products > 0 && (
                  <div>
                    <label htmlFor="cat-move-to" className="block font-semibold text-gray-900 mb-1">
                      Move its {deleting.products} product{deleting.products !== 1 ? 's' : ''} to
                    </label>
                    <select
                      id="cat-move-to"
                      value={moveTo}
                      onChange={(e) => setMoveTo(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">No category (uncategorised)</option>
                      {categories
                        .filter(c => c.id !== deleting.category.id && !descendantIds(deleting.category.id).has(c.id))
                        .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {deleting.children > 0 && (
                  <p>
                    Its {deleting.children} subcategor{deleting.children !== 1 ? 'ies' : 'y'} move up to{' '}
                    {categories.find(c => c.id === deleting.category.parent_id)?.name || 'the top level'}.
                  </p>
                )}
              </div>
            )}
            {deleteError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg text-sm" role="alert">{deleteError}</div>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleting(null)} disabled={deleteBusy} className="px-5 py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:border-gray-400 cursor-pointer">Cancel</button>
              <button onClick={confirmDelete} disabled={deleteBusy} className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold disabled:opacity-50 cursor-pointer">
                {deleteBusy ? 'Deleting...' : 'Delete category'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
