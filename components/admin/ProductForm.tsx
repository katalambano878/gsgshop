'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { notifyMetaCatalog } from '@/lib/meta-admin-client';
import { useRouter } from 'next/navigation';
import { removeProductImageFiles } from '@/app/admin/products/storage-paths';

interface ProductFormProps {
    initialData?: any;
    isEditMode?: boolean;
}

type FieldErrors = Partial<Record<'name' | 'price' | 'slug' | 'sku' | 'status' | 'category_id' | 'variants' | 'stock' | 'compare_at_price' | 'moq' | 'images' | 'form', string>>;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 10;

/** Which tab shows each field, so a field error can open it. */
const FIELD_TAB: Record<string, string> = {
    name: 'general',
    category_id: 'general',
    status: 'general',
    sku: 'pricing',
    price: 'pricing',
    compare_at_price: 'pricing',
    stock: 'pricing',
    moq: 'pricing',
    variants: 'variants',
    images: 'images',
    slug: 'seo',
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

export default function ProductForm({ initialData, isEditMode = false }: ProductFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState<any[]>([]);
    const [categoriesLoaded, setCategoriesLoaded] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

    const [productName, setProductName] = useState(initialData?.name || '');
    const [categoryId, setCategoryId] = useState(initialData?.category_id || '');
    const [price, setPrice] = useState(initialData?.price ?? '');
    const [comparePrice, setComparePrice] = useState(initialData?.compare_at_price ?? '');
    const [sku, setSku] = useState(initialData?.sku || '');
    const [brand, setBrand] = useState(initialData?.brand || '');
    // Stock is written only when this field is edited, so till sales made while the form is open survive.
    const initialStockValue = String(initialData?.quantity ?? '');
    const [stock, setStock] = useState<string>(initialStockValue);
    const [stockTouched, setStockTouched] = useState(false);
    const [trackQuantity, setTrackQuantity] = useState<boolean>(initialData ? initialData.track_quantity !== false : true);
    const [continueSelling, setContinueSelling] = useState<boolean>(initialData ? initialData.continue_selling === true : false);
    const [moq, setMoq] = useState(String(initialData?.moq ?? '1'));
    const initialThreshold = String(initialData?.metadata?.low_stock_threshold ?? '5');
    const [lowStockThreshold, setLowStockThreshold] = useState(initialThreshold);
    const [description, setDescription] = useState(initialData?.description || '');
    // Database values are lowercase ('active' | 'draft' | 'archived'); show the real one.
    const savedStatus = (() => {
        const s = String(initialData?.status || 'active').toLowerCase();
        return ['active', 'draft', 'archived'].includes(s) ? s : 'active';
    })();
    const [status, setStatus] = useState<string>(savedStatus);
    const [featured, setFeatured] = useState(initialData?.featured || false);
    const initialPreorder = initialData?.metadata?.preorder_shipping || '';
    const [preorderShipping, setPreorderShipping] = useState(initialPreorder);
    const [activeTab, setActiveTab] = useState('general');

    // Auto-generate SKU function
    const generateSku = () => {
        const prefix = 'GSG'; // GSG Convenience Goods & More
        const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${prefix}-${timestamp}-${random}`;
    };

    // --- Variant System ---
    // Preset color palette
    const colorPresets = [
        { name: 'Black', hex: '#000000' },
        { name: 'White', hex: '#FFFFFF' },
        { name: 'Red', hex: '#EF4444' },
        { name: 'Blue', hex: '#3B82F6' },
        { name: 'Navy', hex: '#1E3A5F' },
        { name: 'Green', hex: '#22C55E' },
        { name: 'Yellow', hex: '#EAB308' },
        { name: 'Pink', hex: '#EC4899' },
        { name: 'Purple', hex: '#A855F7' },
        { name: 'Orange', hex: '#F97316' },
        { name: 'Gray', hex: '#6B7280' },
        { name: 'Brown', hex: '#92400E' },
        { name: 'Beige', hex: '#D2B48C' },
        { name: 'Maroon', hex: '#800000' },
        { name: 'Teal', hex: '#14B8A6' },
        { name: 'Cream', hex: '#FFFDD0' },
        { name: 'Gold', hex: '#D4AF37' },
        { name: 'Silver', hex: '#C0C0C0' },
    ];
    const sizePresets = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

    // Build variants from colors × sizes (or just sizes, or just colors)
    const buildVariantKey = (color: string, size: string) => `${color}|||${size}`;

    // Existing variants as stored. Size comes from option1 and colour from option2 only,
    // never from the variant name, so a colour can never turn into a size.
    const storedVariants: any[] = (initialData?.product_variants || []).map((v: any) => ({
        ...v,
        size: String(v.option1 || '').trim(),
        color: String(v.option2 || '').trim(),
    }));
    // The grid can show one variant per colour/size pair. Variants without options
    // (made elsewhere) or a second variant with the same pair are kept exactly as they are.
    const [gridVariantByKey] = useState<Map<string, any>>(() => {
        const map = new Map<string, any>();
        storedVariants.forEach((v) => {
            if (!v.size && !v.color) return;
            const key = buildVariantKey(v.color, v.size);
            if (!map.has(key)) map.set(key, v);
        });
        return map;
    });
    const [untouchedVariants] = useState<any[]>(() => {
        const seen = new Set<string>();
        return storedVariants.filter((v) => {
            if (!v.size && !v.color) return true;
            const key = buildVariantKey(v.color, v.size);
            if (seen.has(key)) return true;
            seen.add(key);
            return false;
        });
    });

    const [selectedColors, setSelectedColors] = useState<{ name: string; hex: string }[]>(() => {
        const colors = new Map<string, string>();
        gridVariantByKey.forEach((v: any) => {
            if (v.color && !colors.has(v.color)) {
                const preset = colorPresets.find(c => c.name.toLowerCase() === v.color.toLowerCase());
                colors.set(v.color, v.metadata?.color_hex || preset?.hex || '#888888');
            }
        });
        return Array.from(colors.entries()).map(([name, hex]) => ({ name, hex }));
    });

    const [selectedSizes, setSelectedSizes] = useState<string[]>(() => {
        const sizes = new Set<string>();
        gridVariantByKey.forEach((v: any) => {
            if (v.size) sizes.add(v.size);
        });
        return Array.from(sizes);
    });

    const [customColorName, setCustomColorName] = useState('');
    const [customColorHex, setCustomColorHex] = useState('#888888');
    const [customSize, setCustomSize] = useState('');

    // Store variant data (price, stock) in a map keyed by "color|||size"
    const [variantData, setVariantData] = useState<Record<string, { price: string; stock: string; sku: string }>>(() => {
        const data: Record<string, { price: string; stock: string; sku: string }> = {};
        gridVariantByKey.forEach((v: any, key: string) => {
            data[key] = {
                price: v.price?.toString() || '',
                stock: String(v.quantity ?? 0),
                sku: v.sku || ''
            };
        });
        return data;
    });

    // Variant rows whose stock was edited in this form (only those send a quantity).
    const [touchedStockKeys, setTouchedStockKeys] = useState<Set<string>>(() => new Set());
    const markStockTouched = (keys: string[]) => {
        setTouchedStockKeys(prev => {
            const next = new Set(prev);
            keys.forEach(k => next.add(k));
            return next;
        });
    };

    // Computed: all variant combinations
    const variantCombinations = (() => {
        const combos: { color: string; colorHex: string; size: string; key: string }[] = [];
        const colors = selectedColors.length > 0 ? selectedColors : [{ name: '', hex: '' }];
        const sizes = selectedSizes.length > 0 ? selectedSizes : [''];

        for (const color of colors) {
            for (const size of sizes) {
                if (!color.name && !size) continue; // skip if both empty
                const key = buildVariantKey(color.name, size);
                combos.push({ color: color.name, colorHex: color.hex, size, key });
            }
        }
        return combos;
    })();

    // The flat variants list for the grid and the save
    const variants = variantCombinations.map(combo => {
        const d = variantData[combo.key] || { price: price?.toString() || '', stock: '0', sku: '' };
        return {
            key: combo.key,
            name: combo.size,
            color: combo.color,
            colorHex: combo.colorHex,
            sku: d.sku,
            price: d.price || price?.toString() || '',
            stock: d.stock || '0'
        };
    });
    const hasAnyVariants = variants.length > 0 || untouchedVariants.length > 0;

    const updateVariantField = (key: string, field: string, value: string) => {
        if (field === 'stock') markStockTouched([key]);
        setVariantData(prev => ({
            ...prev,
            [key]: { ...prev[key] || { price: price?.toString() || '', stock: '0', sku: '' }, [field]: value }
        }));
    };

    // Bulk set price/stock for all variants
    const bulkSetField = (field: 'price' | 'stock', value: string) => {
        if (field === 'stock') markStockTouched(variantCombinations.map(c => c.key));
        setVariantData(prev => {
            const updated = { ...prev };
            variantCombinations.forEach(combo => {
                updated[combo.key] = { ...updated[combo.key] || { price: price?.toString() || '', stock: '0', sku: '' }, [field]: value };
            });
            return updated;
        });
    };

    const toggleColor = (color: { name: string; hex: string }) => {
        setSelectedColors(prev => {
            const exists = prev.find(c => c.name === color.name);
            if (exists) return prev.filter(c => c.name !== color.name);
            return [...prev, color];
        });
    };

    const toggleSize = (size: string) => {
        setSelectedSizes(prev => {
            if (prev.includes(size)) return prev.filter(s => s !== size);
            return [...prev, size];
        });
    };

    const addCustomColor = () => {
        if (!customColorName.trim()) return;
        const exists = selectedColors.find(c => c.name.toLowerCase() === customColorName.trim().toLowerCase());
        if (!exists) {
            setSelectedColors(prev => [...prev, { name: customColorName.trim(), hex: customColorHex }]);
        }
        setCustomColorName('');
        setCustomColorHex('#888888');
    };

    const addCustomSize = () => {
        if (!customSize.trim()) return;
        if (!selectedSizes.includes(customSize.trim())) {
            setSelectedSizes(prev => [...prev, customSize.trim()]);
        }
        setCustomSize('');
    };

    // Images, in their saved order
    const [images, setImages] = useState<any[]>(() =>
        [...(initialData?.product_images || [])].sort((a: any, b: any) => (Number(a.position) || 0) - (Number(b.position) || 0))
    );
    const [uploading, setUploading] = useState(false);

    // SEO
    const [seoTitle, setSeoTitle] = useState(initialData?.seo_title || '');
    const [metaDescription, setMetaDescription] = useState(initialData?.seo_description || '');
    const [urlSlug, setUrlSlug] = useState(initialData?.slug || '');
    const [slugEdited, setSlugEdited] = useState(!!initialData?.slug);
    const [keywords, setKeywords] = useState(initialData?.tags?.join(', ') || '');

    const tabs = [
        { id: 'general', label: 'General', icon: 'ri-information-line' },
        { id: 'pricing', label: 'Pricing & Inventory', icon: 'ri-price-tag-3-line' },
        { id: 'variants', label: 'Variants', icon: 'ri-layout-grid-line' },
        { id: 'images', label: 'Images', icon: 'ri-image-line' },
        { id: 'seo', label: 'SEO', icon: 'ri-search-line' }
    ];

    // Fetch categories once. Nothing is picked for the staff member: a new product needs a chosen category.
    useEffect(() => {
        async function fetchCategories() {
            const { data, error } = await supabase.from('categories').select('id, name, status').order('name');
            if (error) console.error('Could not load categories:', error);
            setCategories(data || []);
            setCategoriesLoaded(true);
        }
        fetchCategories();
    }, []);

    // New products: the slug follows the name until the slug is edited by hand.
    useEffect(() => {
        if (!isEditMode && !slugEdited) {
            setUrlSlug(slugify(productName));
        }
    }, [productName, isEditMode, slugEdited]);

    // Auto-generate SKU for new products
    useEffect(() => {
        if (!isEditMode && !sku) {
            setSku(generateSku());
        }
    }, [isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        try {
            if (!input.files || input.files.length === 0) return;
            const file = input.files[0];
            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                setFieldErrors(prev => ({ ...prev, images: 'Use a JPG, PNG or WebP image.' }));
                return;
            }
            if (file.size > MAX_IMAGE_BYTES) {
                setFieldErrors(prev => ({ ...prev, images: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.` }));
                return;
            }
            if (images.length >= MAX_IMAGES) {
                setFieldErrors(prev => ({ ...prev, images: `A product can have at most ${MAX_IMAGES} images.` }));
                return;
            }
            setFieldErrors(prev => ({ ...prev, images: undefined }));

            setUploading(true);
            const fileExt = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
            const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('products')
                .upload(filePath, file, { contentType: file.type });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('products')
                .getPublicUrl(filePath);

            setImages(prev => [...prev, { url: publicUrl, position: prev.length, isNew: true }]);

        } catch (error: any) {
            setFieldErrors(prev => ({ ...prev, images: 'Error uploading image: ' + (error?.message || 'unknown error') }));
        } finally {
            setUploading(false);
            input.value = '';
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        const removed = images[indexToRemove];
        setImages(images.filter((_, idx) => idx !== indexToRemove));
        // A file uploaded in this form and not saved yet is deleted straight away.
        // Saved images are deleted from storage after the product is saved.
        if (removed?.isNew && !removed.id) void removeProductImageFiles([removed.url]);
    };

    const moveImage = (index: number, delta: -1 | 1) => {
        const target = index + delta;
        if (target < 0 || target >= images.length) return;
        const next = [...images];
        [next[index], next[target]] = [next[target], next[index]];
        setImages(next);
    };

    const validateForm = (): FieldErrors => {
        const errors: FieldErrors = {};
        const name = productName.trim();
        if (!name) errors.name = 'Enter a product name.';
        if (!isEditMode && !categoryId) errors.category_id = 'Choose a category.';

        const priceNum = Number(price);
        const everyVariantPriced = variants.length > 0 && variants.every(v => Number(v.price) > 0);
        if (price !== '' && (!Number.isFinite(priceNum) || priceNum < 0)) {
            errors.price = 'Enter a valid price (GH₵).';
        } else if (status === 'active' && !(priceNum > 0) && !everyVariantPriced) {
            errors.price = variants.length > 0
                ? 'Set a price above GH₵0, or give every variant its own price (Variants tab).'
                : 'An active product needs a price above GH₵0. Set a price, or save it as Draft.';
        }
        if (comparePrice !== '' && comparePrice !== null && (!Number.isFinite(Number(comparePrice)) || Number(comparePrice) < 0)) {
            errors.compare_at_price = 'Compare-at price must be a number (or leave it empty).';
        }
        const slug = slugify(urlSlug || name);
        if (!slug) errors.slug = 'Enter a URL slug (letters or numbers).';
        else if (urlSlug && slug !== urlSlug) errors.slug = `Use lower-case letters, numbers and dashes only, for example "${slug}".`;

        const moqNum = Number(moq);
        if (!Number.isInteger(moqNum) || moqNum < 1) errors.moq = 'Minimum order quantity must be a whole number of 1 or more.';

        if (variants.length === 0) {
            if (stock !== '' && (!Number.isInteger(Number(stock)) || Number(stock) < 0)) errors.stock = 'Stock must be a whole number, 0 or more.';
        } else {
            for (const v of variants) {
                const label = [v.name, v.color].filter(Boolean).join(' / ') || 'Default';
                const vp = Number(v.price);
                if (!Number.isFinite(vp) || vp < 0) { errors.variants = `Variant "${label}" has an invalid price.`; break; }
                if (status === 'active' && !(vp > 0)) { errors.variants = `Variant "${label}" needs a price above GH₵0 for an active product.`; break; }
                if (!Number.isInteger(Number(v.stock)) || Number(v.stock) < 0) { errors.variants = `Variant "${label}" has invalid stock.`; break; }
            }
        }
        return errors;
    };

    const showErrors = (errors: FieldErrors) => {
        setFieldErrors(errors);
        const first = Object.keys(errors).find((k) => (errors as any)[k]);
        if (first && FIELD_TAB[first]) setActiveTab(FIELD_TAB[first]);
    };

    const handleSubmit = async () => {
        if (loading) return;
        const errors = validateForm();
        if (Object.keys(errors).length > 0) {
            showErrors(errors);
            return;
        }
        setFieldErrors({});

        try {
            setLoading(true);

            const hasVariants = variants.length > 0;
            const variantStockTotal = variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);

            // Metadata goes as a patch: the server merges it, so keys written by
            // payments, the till or the Meta sync are never dropped.
            const thresholdNum = parseInt(lowStockThreshold);
            const metadataPatch: Record<string, unknown> = {};
            if (!isEditMode || lowStockThreshold !== initialThreshold) {
                metadataPatch.low_stock_threshold = Number.isFinite(thresholdNum) && thresholdNum >= 0 ? thresholdNum : 5;
            }
            if (!isEditMode || preorderShipping !== initialPreorder) {
                metadataPatch.preorder_shipping = preorderShipping.trim() || null;
            }

            const product: Record<string, unknown> = {
                name: productName.trim(),
                slug: slugify(urlSlug || productName.trim()),
                description,
                price: Number(price) || 0,
                compare_at_price: comparePrice !== '' && comparePrice !== null ? Number(comparePrice) : null,
                category_id: categoryId || null,
                status,
                sku: sku || generateSku(),
                track_quantity: trackQuantity,
                continue_selling: continueSelling,
                moq: parseInt(moq) || 1,
                ...(Object.keys(metadataPatch).length > 0 ? { metadataPatch } : {}),
            };
            // Columns the save route does not take (brand, featured, SEO, keywords): written
            // after it, and only when they changed.
            const tagList = (keywords as string).split(',').map((k: string) => k.trim()).filter(Boolean);
            const extraFields: Record<string, unknown> = {};
            if (!isEditMode || (brand.trim() || null) !== (initialData?.brand || null)) extraFields.brand = brand.trim() || null;
            if (!isEditMode || !!featured !== !!initialData?.featured) extraFields.featured = !!featured;
            if (!isEditMode || seoTitle !== (initialData?.seo_title || '')) extraFields.seo_title = seoTitle || null;
            if (!isEditMode || metaDescription !== (initialData?.seo_description || '')) extraFields.seo_description = metaDescription || null;
            if (!isEditMode || tagList.join(',') !== (initialData?.tags || []).join(',')) extraFields.tags = tagList;
            // Stock: always for a new product; on edit only when the stock field was changed.
            if (!isEditMode) {
                product.quantity = hasVariants ? variantStockTotal : (parseInt(stock) || 0);
            } else if (!hasVariants && stockTouched) {
                product.quantity = parseInt(stock) || 0;
            }

            // Variants: the full desired list. Existing ones go by id with only the edited fields.
            let variantPayload: Record<string, unknown>[] | undefined;
            if (hasAnyVariants || storedVariants.length > 0) {
                variantPayload = variants.map((v) => {
                    const existing = gridVariantByKey.get(v.key);
                    const colorHex = v.color ? (v.colorHex || null) : null;
                    if (existing) {
                        const row: Record<string, unknown> = { id: existing.id };
                        if (Number(v.price) !== Number(existing.price)) row.price = Number(v.price) || 0;
                        if ((v.sku || '') !== (existing.sku || '')) row.sku = v.sku || null;
                        if (touchedStockKeys.has(v.key)) row.quantity = parseInt(v.stock) || 0;
                        if (colorHex && colorHex !== (existing.metadata?.color_hex || null)) row.metadataPatch = { color_hex: colorHex };
                        return row;
                    }
                    return {
                        name: [v.name, v.color].filter(Boolean).join(' / ') || 'Default',
                        option1: v.name || null,
                        option2: v.color || null,
                        sku: v.sku || null,
                        price: Number(v.price) || 0,
                        quantity: parseInt(v.stock) || 0,
                        ...(colorHex ? { metadataPatch: { color_hex: colorHex } } : {}),
                    };
                });
                // Variants the grid cannot show are kept exactly as they are.
                untouchedVariants.forEach((v) => variantPayload!.push({ id: v.id }));
            }

            const body: Record<string, unknown> = {
                ...(isEditMode && initialData?.id ? { id: initialData.id } : {}),
                product,
                images: images.map((img, idx) => ({
                    ...(img.id ? { id: img.id } : {}),
                    url: img.url,
                    position: idx,
                    alt: img.alt_text || productName.trim(),
                })),
                ...(variantPayload ? { variants: variantPayload } : {}),
            };

            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch('/api/admin/products/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                },
                body: JSON.stringify(body),
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result?.success) {
                const message = result?.error || result?.message || `Save failed (${res.status})`;
                if (result?.field) {
                    showErrors({ [result.field]: message } as FieldErrors);
                } else {
                    setFieldErrors({ form: message });
                }
                return;
            }

            const productId: string = result.id || initialData?.id;

            const notices: string[] = [];
            if (productId && Object.keys(extraFields).length > 0) {
                const { error: extraError } = await supabase.from('products').update(extraFields).eq('id', productId);
                if (extraError) notices.push(`The product was saved, but brand, featured, SEO or keywords were not: ${extraError.message}. Open it and save again.`);
            }

            // Saved images that were removed: delete their files now that the rows are gone.
            const keptIds = new Set(images.map((img) => img.id).filter(Boolean));
            const removedUrls = (initialData?.product_images || [])
                .filter((img: any) => !keptIds.has(img.id))
                .map((img: any) => img.url);
            const leftoverFiles = removedUrls.length > 0 ? await removeProductImageFiles(removedUrls) : 0;

            // Send the new price / stock / photos to the Facebook, Instagram and WhatsApp catalogue.
            if (productId) await notifyMetaCatalog({ action: 'product', productIds: [productId] });

            const kept = Array.isArray(result.keptVariants) ? result.keptVariants : [];
            if (kept.length > 0) {
                notices.push(
                    `${kept.length} removed variant${kept.length === 1 ? ' was' : 's were'} kept because orders or carts use ${kept.length === 1 ? 'it' : 'them'}: ` +
                    kept.map((k: any) => k.name || k.id).join(', ') +
                    '. To stop selling one, add its option back and set its stock to 0.'
                );
            }
            if (leftoverFiles > 0) notices.push(`${leftoverFiles} removed image file${leftoverFiles === 1 ? '' : 's'} could not be deleted from storage.`);

            alert((isEditMode ? 'Product updated.' : 'Product created.') + (notices.length ? '\n\n' + notices.join('\n\n') : ''));
            router.push('/admin/products');

        } catch (err: any) {
            console.error('Error saving product:', err);
            setFieldErrors({ form: `Could not reach the server: ${err?.message || 'network error'}. Check the product list before trying again, in case it was saved.` });
        } finally {
            setLoading(false);
        }
    };

    const inputError = (field: keyof FieldErrors) =>
        fieldErrors[field] ? (
            <p id={`pf-${field}-error`} role="alert" className="text-sm text-red-600 mt-1">{fieldErrors[field]}</p>
        ) : null;
    const errorBorder = (field: keyof FieldErrors) => (fieldErrors[field] ? 'border-red-400' : 'border-gray-300');
    const productUrlKey = initialData?.slug || initialData?.id;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link
                        href="/admin/products"
                        aria-label="Back to products"
                        className="w-10 h-10 flex items-center justify-center border-2 border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
                    >
                        <i className="ri-arrow-left-line text-xl text-gray-700" aria-hidden="true"></i>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            {isEditMode ? 'Edit Product' : 'Add New Product'}
                        </h1>
                        <p className="text-gray-600 mt-1">
                            {isEditMode ? 'Update product information and settings' : 'Create a new product for your catalog'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    {/* The shop only shows active products, so Preview is offered for the saved, active product only. */}
                    {isEditMode && savedStatus === 'active' && productUrlKey && (
                        <Link
                            href={`/product/${productUrlKey}`}
                            target="_blank"
                            className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-semibold whitespace-nowrap cursor-pointer flex items-center"
                        >
                            <i className="ri-eye-line mr-2"></i>
                            Preview
                        </Link>
                    )}
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className={`px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        {loading ? (
                            <>
                                <i className="ri-loader-4-line animate-spin mr-2"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="ri-save-line mr-2"></i>
                                {isEditMode ? 'Save Changes' : 'Create Product'}
                            </>
                        )}
                    </button>
                </div>
            </div>

            {isEditMode && savedStatus !== 'active' && (
                <p className="text-sm text-gray-600">
                    This product is saved as <strong className="capitalize">{savedStatus}</strong>, so it is hidden from the shop and has no preview.
                </p>
            )}

            {Object.values(fieldErrors).some(Boolean) && (
                <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
                    <i className="ri-error-warning-line text-lg leading-none" aria-hidden="true"></i>
                    <div>
                        {fieldErrors.form ? <p>{fieldErrors.form}</p> : <p>Please fix these before saving:</p>}
                        <ul className="list-disc ml-5 mt-1">
                            {Object.entries(fieldErrors).filter(([k, v]) => k !== 'form' && v).map(([k, v]) => (
                                <li key={k}>
                                    <button type="button" className="underline text-left" onClick={() => FIELD_TAB[k] && setActiveTab(FIELD_TAB[k])}>{v}</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="border-b border-gray-200 overflow-x-auto">
                    <div className="flex">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-2 px-6 py-4 font-semibold whitespace-nowrap transition-colors border-b-2 cursor-pointer ${activeTab === tab.id
                                    ? 'border-blue-700 text-blue-700 bg-blue-50'
                                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                            >
                                <i className={`${tab.icon} text-xl`}></i>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-8">
                    {activeTab === 'general' && (
                        <div className="space-y-6 max-w-3xl">
                            <div>
                                <label htmlFor="pf-name" className="block text-sm font-semibold text-gray-900 mb-2">
                                    Product Name *
                                </label>
                                <input
                                    id="pf-name"
                                    type="text"
                                    value={productName}
                                    onChange={(e) => setProductName(e.target.value)}
                                    aria-invalid={!!fieldErrors.name}
                                    className={`w-full px-4 py-3 border-2 ${errorBorder('name')} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                                    placeholder="Enter product name"
                                />
                                {inputError('name')}
                            </div>

                            <div>
                                <label htmlFor="pf-description" className="block text-sm font-semibold text-gray-900 mb-2">
                                    Description
                                </label>
                                <textarea
                                    id="pf-description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={6}
                                    maxLength={500}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                                    placeholder="Describe your product..."
                                />
                                <p className="text-sm text-gray-500 mt-2">{description.length}/500 characters</p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="pf-category" className="block text-sm font-semibold text-gray-900 mb-2">
                                        Category *
                                    </label>
                                    <select
                                        id="pf-category"
                                        value={categoryId}
                                        onChange={(e) => setCategoryId(e.target.value)}
                                        aria-invalid={!!fieldErrors.category_id}
                                        className={`w-full px-4 py-3 pr-8 border-2 ${errorBorder('category_id')} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer`}
                                    >
                                        {!categoriesLoaded && <option value="">Loading categories...</option>}
                                        {categoriesLoaded && <option value="">{categories.length === 0 ? 'No categories yet' : 'Select a category'}</option>}
                                        {categories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}{cat.status && cat.status !== 'active' ? ' (hidden)' : ''}</option>
                                        ))}
                                    </select>
                                    {inputError('category_id')}
                                </div>

                                <div>
                                    <label htmlFor="pf-status" className="block text-sm font-semibold text-gray-900 mb-2">
                                        Status
                                    </label>
                                    <select
                                        id="pf-status"
                                        value={status}
                                        onChange={(e) => setStatus(e.target.value)}
                                        className="w-full px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                                    >
                                        <option value="active">Active (shown in shop)</option>
                                        <option value="draft">Draft (hidden)</option>
                                        <option value="archived">Archived (hidden)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center space-x-3">
                                <input
                                    id="pf-featured"
                                    type="checkbox"
                                    checked={featured}
                                    onChange={(e) => setFeatured(e.target.checked)}
                                    className="w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                />
                                <label htmlFor="pf-featured" className="text-gray-900 font-medium">
                                    Feature this product on homepage
                                </label>
                            </div>

                            <div>
                                <label htmlFor="pf-preorder" className="block text-sm font-semibold text-gray-900 mb-2">
                                    Pre-order / Estimated Shipping
                                </label>
                                <input
                                    id="pf-preorder"
                                    type="text"
                                    value={preorderShipping}
                                    onChange={(e) => setPreorderShipping(e.target.value)}
                                    placeholder="e.g., Ships in 14 days, Available March 15"
                                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                                <p className="text-xs text-gray-500 mt-1">Leave empty if product ships immediately. Otherwise, enter estimated shipping time.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'pricing' && (
                        <div className="space-y-6 max-w-3xl">
                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="pf-price" className="block text-sm font-semibold text-gray-900 mb-2">
                                        Price (GH₵) *
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                        <input
                                            id="pf-price"
                                            type="number"
                                            value={price}
                                            onChange={(e) => setPrice(e.target.value)}
                                            aria-invalid={!!fieldErrors.price}
                                            min="0"
                                            className={`w-full pl-16 pr-4 py-3 border-2 ${errorBorder('price')} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                                            step="0.01"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    {inputError('price')}
                                </div>

                                <div>
                                    <label htmlFor="pf-compare-price" className="block text-sm font-semibold text-gray-900 mb-2">
                                        Compare at Price (GH₵)
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 font-semibold">GH₵</span>
                                        <input
                                            id="pf-compare-price"
                                            type="number"
                                            value={comparePrice}
                                            onChange={(e) => setComparePrice(e.target.value)}
                                            min="0"
                                            className={`w-full pl-16 pr-4 py-3 border-2 ${errorBorder('compare_at_price')} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                                            step="0.01"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    {inputError('compare_at_price')}
                                    <p className="text-sm text-gray-500 mt-2">Show original price for comparison</p>
                                </div>
                            </div>

                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="text-blue-900 font-semibold mb-1">Discount Calculation</p>
                                {price && comparePrice && parseFloat(comparePrice) > parseFloat(price) ? (
                                    <p className="text-blue-800">
                                        Savings: GH₵ {(parseFloat(comparePrice) - parseFloat(price)).toFixed(2)}
                                        <span className="ml-2">
                                            ({(((parseFloat(comparePrice) - parseFloat(price)) / parseFloat(comparePrice)) * 100).toFixed(0)}% off)
                                        </span>
                                    </p>
                                ) : (
                                    <p className="text-blue-800 text-sm">Enter a valid compare price higher than the price to see discount.</p>
                                )}
                            </div>

                            <div className="pt-6 border-t border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 mb-4">Inventory</h3>

                                <div className="grid md:grid-cols-2 gap-6">
                                    <div>
                                        <label htmlFor="pf-brand" className="block text-sm font-semibold text-gray-900 mb-2">
                                            Brand (manufacturer)
                                        </label>
                                        <input
                                            id="pf-brand"
                                            type="text"
                                            value={brand}
                                            onChange={(e) => setBrand(e.target.value)}
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="e.g. Nestlé, Don Simon, McBerry"
                                        />
                                        <p className="text-sm text-gray-500 mt-1">Shown in the Facebook, Instagram and WhatsApp catalogues.</p>
                                    </div>

                                    <div>
                                        <label htmlFor="pf-sku" className="block text-sm font-semibold text-gray-900 mb-2">
                                            SKU (Auto-generated)
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                id="pf-sku"
                                                type="text"
                                                value={sku}
                                                onChange={(e) => setSku(e.target.value)}
                                                className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono bg-gray-50"
                                                placeholder="Auto-generated"
                                                readOnly
                                            />
                                            {/* An existing product's SKU is its Meta/Google catalogue id — it must never change. */}
                                            {!isEditMode && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSku(generateSku())}
                                                    className="px-4 py-3 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
                                                    title="Generate new SKU"
                                                    aria-label="Generate new SKU"
                                                >
                                                    <i className="ri-refresh-line text-lg"></i>
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1">
                                            {isEditMode
                                                ? 'SKU is locked: Facebook, Instagram, WhatsApp and Google use it to identify this product.'
                                                : 'SKU is auto-generated. Click refresh to generate a new one.'}
                                        </p>
                                    </div>

                                    <div>
                                        <label htmlFor="pf-stock" className="block text-sm font-semibold text-gray-900 mb-2">
                                            Stock Quantity *
                                        </label>
                                        {variants.length > 0 ? (
                                            <div>
                                                <input
                                                    id="pf-stock"
                                                    aria-describedby="pf-stock-note"
                                                    type="number"
                                                    value={variants.reduce((sum: number, v: any) => sum + (parseInt(v.stock) || 0), 0)}
                                                    readOnly
                                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                                                />
                                                <p id="pf-stock-note" className="text-sm text-amber-600 mt-1 flex items-center">
                                                    <i className="ri-information-line mr-1"></i>
                                                    Stock is managed per variant. Edit stock in the Variants tab.
                                                </p>
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    id="pf-stock"
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={stock}
                                                    onChange={(e) => { setStock(e.target.value); setStockTouched(true); }}
                                                    aria-invalid={!!fieldErrors.stock}
                                                    className={`w-full px-4 py-3 border-2 ${errorBorder('stock')} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                                                    placeholder="0"
                                                />
                                                {isEditMode && (
                                                    <p className="text-sm text-gray-500 mt-1">
                                                        {stockTouched
                                                            ? 'The stock will be set to this number when you save.'
                                                            : 'Stock as loaded. It is only saved if you change it, so till sales made meanwhile are kept.'}
                                                    </p>
                                                )}
                                                {inputError('stock')}
                                            </>
                                        )}
                                    </div>

                                    <div className="md:col-span-2 space-y-3">
                                        <div className="flex items-center space-x-3">
                                            <input
                                                id="pf-track-quantity"
                                                type="checkbox"
                                                checked={trackQuantity}
                                                onChange={(e) => setTrackQuantity(e.target.checked)}
                                                className="w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                            />
                                            <label htmlFor="pf-track-quantity" className="text-gray-900 font-medium">
                                                Track stock for this product
                                            </label>
                                        </div>
                                        <div className="flex items-center space-x-3">
                                            <input
                                                id="pf-continue-selling"
                                                type="checkbox"
                                                checked={continueSelling}
                                                disabled={!trackQuantity}
                                                onChange={(e) => setContinueSelling(e.target.checked)}
                                                className="w-5 h-5 text-blue-700 border-gray-300 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                                            />
                                            <label htmlFor="pf-continue-selling" className="text-gray-900 font-medium">
                                                Keep selling when out of stock
                                            </label>
                                        </div>
                                        <p className="text-xs text-gray-500">When stock is tracked and this is off, the shop and the till stop selling at 0.</p>
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 gap-6 mt-6">
                                    <div>
                                        <label htmlFor="pf-moq" className="block text-sm font-semibold text-gray-900 mb-2">
                                            Minimum Order Quantity (MOQ)
                                        </label>
                                        <input
                                            id="pf-moq"
                                            type="number"
                                            value={moq}
                                            onChange={(e) => setMoq(e.target.value)}
                                            min="1"
                                            step="1"
                                            aria-invalid={!!fieldErrors.moq}
                                            className={`w-full px-4 py-3 border-2 ${errorBorder('moq')} rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                                            placeholder="1"
                                        />
                                        {inputError('moq')}
                                        <p className="text-sm text-gray-500 mt-1">Minimum quantity customers must order</p>
                                    </div>

                                    <div>
                                        <label htmlFor="pf-low-stock" className="block text-sm font-semibold text-gray-900 mb-2">
                                            Low Stock Threshold
                                        </label>
                                        <input
                                            id="pf-low-stock"
                                            type="number"
                                            value={lowStockThreshold}
                                            onChange={(e) => setLowStockThreshold(e.target.value)}
                                            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                        <p className="text-sm text-gray-500 mt-1">Shown as low stock on the dashboard when stock is at or below this number</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'variants' && (
                        <div className="space-y-8">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Product Variants</h3>
                                <p className="text-gray-600 mt-1">Select colors and sizes below — variants are generated automatically</p>
                            </div>

                            {/* STEP 1: Colors */}
                            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                                <h4 className="text-sm font-bold text-gray-900 mb-1 flex items-center">
                                    <i className="ri-palette-line mr-2 text-lg text-blue-700"></i>
                                    Step 1: Select Colors
                                    {selectedColors.length > 0 && (
                                        <span className="ml-2 bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                                            {selectedColors.length} selected
                                        </span>
                                    )}
                                </h4>
                                <p className="text-xs text-gray-500 mb-4">Click colors to add/remove. Skip if product has no color options.</p>

                                <div className="flex flex-wrap gap-2 mb-4">
                                    {colorPresets.map(color => {
                                        const isSelected = selectedColors.some(c => c.name === color.name);
                                        return (
                                            <button
                                                key={color.name}
                                                onClick={() => toggleColor(color)}
                                                className={`flex items-center space-x-2 px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium ${isSelected
                                                        ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                                                        : 'border-gray-200 hover:border-gray-300 bg-white'
                                                    }`}
                                                title={color.name}
                                            >
                                                <span
                                                    className="w-5 h-5 rounded-full border border-gray-300 flex-shrink-0"
                                                    style={{ backgroundColor: color.hex }}
                                                ></span>
                                                <span className={isSelected ? 'text-blue-800' : 'text-gray-700'}>{color.name}</span>
                                                {isSelected && <i className="ri-check-line text-blue-700"></i>}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Custom color */}
                                <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
                                    <input
                                        type="color"
                                        value={customColorHex}
                                        onChange={(e) => setCustomColorHex(e.target.value)}
                                        className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer p-0.5"
                                        title="Pick a custom color"
                                        aria-label="Custom colour"
                                    />
                                    <input
                                        type="text"
                                        value={customColorName}
                                        onChange={(e) => setCustomColorName(e.target.value)}
                                        placeholder="Custom color name"
                                        aria-label="Custom colour name"
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        onKeyDown={(e) => e.key === 'Enter' && addCustomColor()}
                                    />
                                    <button
                                        onClick={addCustomColor}
                                        disabled={!customColorName.trim()}
                                        className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add Color
                                    </button>
                                </div>

                                {/* Selected colors summary */}
                                {selectedColors.length > 0 && (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {selectedColors.map(color => (
                                            <span key={color.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm shadow-sm">
                                                <span className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ backgroundColor: color.hex }}></span>
                                                {color.name}
                                                <button type="button" onClick={() => toggleColor(color)} aria-label={`Remove colour ${color.name}`} className="text-gray-400 hover:text-red-500 ml-1">
                                                    <i className="ri-close-line text-sm"></i>
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* STEP 2: Sizes */}
                            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                                <h4 className="text-sm font-bold text-gray-900 mb-1 flex items-center">
                                    <i className="ri-ruler-line mr-2 text-lg text-blue-600"></i>
                                    Step 2: Select Sizes
                                    {selectedSizes.length > 0 && (
                                        <span className="ml-2 bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                                            {selectedSizes.length} selected
                                        </span>
                                    )}
                                </h4>
                                <p className="text-xs text-gray-500 mb-4">Click sizes to add/remove. Use custom for volumes (100ml), weights, etc.</p>

                                <div className="flex flex-wrap gap-2 mb-4">
                                    {sizePresets.map(size => {
                                        const isSelected = selectedSizes.includes(size);
                                        return (
                                            <button
                                                key={size}
                                                onClick={() => toggleSize(size)}
                                                className={`px-5 py-2.5 rounded-lg border-2 font-semibold text-sm transition-all ${isSelected
                                                        ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600'
                                                        : 'border-gray-200 hover:border-gray-300 bg-white text-gray-700'
                                                    }`}
                                            >
                                                {size}
                                                {isSelected && <i className="ri-check-line ml-1.5 text-blue-600"></i>}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Custom size */}
                                <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
                                    <input
                                        type="text"
                                        value={customSize}
                                        onChange={(e) => setCustomSize(e.target.value)}
                                        placeholder="Custom size (e.g. 100ml, One Size, 42)"
                                        aria-label="Custom size"
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        onKeyDown={(e) => e.key === 'Enter' && addCustomSize()}
                                    />
                                    <button
                                        onClick={addCustomSize}
                                        disabled={!customSize.trim()}
                                        className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add Size
                                    </button>
                                </div>

                                {/* Selected sizes summary */}
                                {selectedSizes.length > 0 && (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {selectedSizes.map(size => (
                                            <span key={size} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm shadow-sm font-medium">
                                                {size}
                                                <button type="button" onClick={() => toggleSize(size)} aria-label={`Remove size ${size}`} className="text-gray-400 hover:text-red-500 ml-1">
                                                    <i className="ri-close-line text-sm"></i>
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {inputError('variants')}

                            {untouchedVariants.length > 0 && (
                                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                                    <p className="font-semibold mb-1">Other variants (kept as they are)</p>
                                    <p className="mb-2">These variants have no colour/size, or repeat a colour and size already in the grid, so they are not edited here and are never removed by this form:</p>
                                    <ul className="list-disc ml-5">
                                        {untouchedVariants.map((v: any) => (
                                            <li key={v.id}>{v.name || 'Unnamed'}{v.sku ? ` (${v.sku})` : ''}: GH₵ {Number(v.price || 0).toFixed(2)}, stock {v.quantity ?? 0}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* STEP 3: Variant Grid */}
                            {variantCombinations.length > 0 && (
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-900 flex items-center">
                                                <i className="ri-grid-line mr-2 text-lg text-purple-600"></i>
                                                Step 3: Set Price & Stock ({variantCombinations.length} variant{variantCombinations.length > 1 ? 's' : ''})
                                            </h4>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set price for ALL variants:', price?.toString() || '0');
                                                    if (val !== null) bulkSetField('price', val);
                                                }}
                                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                Bulk Set Price
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const val = prompt('Set stock for ALL variants:', '0');
                                                    if (val !== null) bulkSetField('stock', val);
                                                }}
                                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                                            >
                                                Bulk Set Stock
                                            </button>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-gray-50 border-b border-gray-200">
                                                <tr>
                                                    {selectedColors.length > 0 && (
                                                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Color</th>
                                                    )}
                                                    {selectedSizes.length > 0 && (
                                                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Size</th>
                                                    )}
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Price (GH₵)</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Stock</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {variantCombinations.map((combo) => {
                                                    const d = variantData[combo.key] || { price: price?.toString() || '', stock: '0', sku: '' };
                                                    return (
                                                        <tr key={combo.key} className="border-b border-gray-100 hover:bg-gray-50">
                                                            {selectedColors.length > 0 && (
                                                                <td className="py-3 px-4">
                                                                    <div className="flex items-center gap-2">
                                                                        <span
                                                                            className="w-5 h-5 rounded-full border border-gray-300 flex-shrink-0"
                                                                            style={{ backgroundColor: combo.colorHex }}
                                                                        ></span>
                                                                        <span className="text-sm font-medium text-gray-900">{combo.color}</span>
                                                                    </div>
                                                                </td>
                                                            )}
                                                            {selectedSizes.length > 0 && (
                                                                <td className="py-3 px-4">
                                                                    <span className="text-sm font-semibold text-gray-900 bg-gray-100 px-2.5 py-1 rounded">
                                                                        {combo.size}
                                                                    </span>
                                                                </td>
                                                            )}
                                                            <td className="py-3 px-4">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    aria-label={`Price for ${[combo.size, combo.color].filter(Boolean).join(' / ')}`}
                                                                    value={d.price}
                                                                    onChange={(e) => updateVariantField(combo.key, 'price', e.target.value)}
                                                                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                    step="0.01"
                                                                    placeholder={price?.toString() || '0'}
                                                                />
                                                            </td>
                                                            <td className="py-3 px-4">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="1"
                                                                    aria-label={`Stock for ${[combo.size, combo.color].filter(Boolean).join(' / ')}`}
                                                                    value={d.stock}
                                                                    onChange={(e) => updateVariantField(combo.key, 'stock', e.target.value)}
                                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="p-3 bg-blue-50 border-t border-blue-100">
                                        <p className="text-xs text-blue-800 flex items-center">
                                            <i className="ri-information-line mr-1.5"></i>
                                            Total stock across all variants: <strong className="ml-1">{variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0)}</strong>
                                        </p>
                                    </div>
                                </div>
                            )}

                            {variantCombinations.length === 0 && (
                                <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                    <i className="ri-palette-line text-4xl text-gray-300 mb-2 block"></i>
                                    <p className="font-medium">No variants configured</p>
                                    <p className="text-sm mt-1">Select colors and/or sizes above to create variant combinations.</p>
                                    <p className="text-xs mt-2 text-gray-400">You can add just colors, just sizes, or both for a full grid.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'images' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Product Images</h3>
                                <p className="text-gray-600">Add up to 10 images. First image will be the primary image.</p>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {images.map((img: any, index: number) => (
                                    <div key={img.id || img.url} className="relative group">
                                        <div className="aspect-square bg-gray-100 rounded-xl overflow-hidden border-2 border-gray-200">
                                            <img src={img.url} alt={`Product ${index + 1}`} className="w-full h-full object-cover" />
                                        </div>
                                        {index === 0 && (
                                            <span className="absolute top-2 left-2 bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold whitespace-nowrap">
                                                Primary
                                            </span>
                                        )}
                                        <div className="mt-2 flex items-center justify-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => moveImage(index, -1)}
                                                disabled={index === 0}
                                                aria-label={`Move image ${index + 1} left`}
                                                title="Move left"
                                                className="w-9 h-9 flex items-center justify-center bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <i className="ri-arrow-left-line" aria-hidden="true"></i>
                                            </button>
                                            <a href={img.url} target="_blank" rel="noreferrer" aria-label={`Open image ${index + 1}`} title="Open" className="w-9 h-9 flex items-center justify-center bg-white border border-gray-300 text-gray-900 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                                                <i className="ri-eye-line" aria-hidden="true"></i>
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => moveImage(index, 1)}
                                                disabled={index === images.length - 1}
                                                aria-label={`Move image ${index + 1} right`}
                                                title="Move right"
                                                className="w-9 h-9 flex items-center justify-center bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <i className="ri-arrow-right-line" aria-hidden="true"></i>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveImage(index)}
                                                aria-label={`Remove image ${index + 1}`}
                                                title="Remove"
                                                className="w-9 h-9 flex items-center justify-center bg-white border border-gray-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                            >
                                                <i className="ri-delete-bin-line" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                <label className={`aspect-square border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-700 hover:bg-blue-50 transition-colors flex flex-col items-center justify-center space-y-2 text-gray-600 hover:text-blue-700 cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {uploading ? (
                                        <i className="ri-loader-4-line animate-spin text-3xl"></i>
                                    ) : (
                                        <i className="ri-upload-2-line text-3xl"></i>
                                    )}
                                    <span className="text-sm font-semibold">{uploading ? 'Uploading...' : 'Upload Image'}</span>
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        className="sr-only"
                                        aria-label="Upload product image"
                                        onChange={handleImageUpload}
                                        disabled={uploading || images.length >= MAX_IMAGES}
                                    />
                                </label>
                            </div>

                            {inputError('images')}

                            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                                <p className="text-sm text-gray-700">
                                    <strong>Image Guidelines:</strong> Use high-quality images (min 1000x1000px), white or neutral backgrounds work best.
                                    Supported formats: JPG, PNG, WebP (max 5MB each). Use the arrows to change the order; the first image is the primary one. Removed images are deleted when you save.
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'seo' && (
                        <div className="space-y-6 max-w-3xl">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-1">Search Engine Optimization</h3>
                                <p className="text-gray-600">Optimize how this product appears in search results</p>
                            </div>

                            <div>
                                <label htmlFor="pf-seo-title" className="block text-sm font-semibold text-gray-900 mb-2">
                                    Page Title
                                </label>
                                <input
                                    id="pf-seo-title"
                                    type="text"
                                    value={seoTitle}
                                    onChange={(e) => setSeoTitle(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Seo friendly title"
                                />
                                <p className="text-sm text-gray-500 mt-2">60 characters recommended</p>
                            </div>

                            <div>
                                <label htmlFor="pf-meta-description" className="block text-sm font-semibold text-gray-900 mb-2">
                                    Meta Description
                                </label>
                                <textarea
                                    id="pf-meta-description"
                                    rows={3}
                                    maxLength={500}
                                    value={metaDescription}
                                    onChange={(e) => setMetaDescription(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                                    placeholder="Seo friendly description"
                                />
                                <p className="text-sm text-gray-500 mt-2">160 characters recommended</p>
                            </div>

                            <div>
                                <label htmlFor="pf-slug" className="block text-sm font-semibold text-gray-900 mb-2">
                                    URL Slug
                                </label>
                                <div className="flex items-center">
                                    <span className="text-gray-600 bg-gray-100 px-4 py-3 border-2 border-r-0 border-gray-300 rounded-l-lg">
                                        goods.gsgbrands.com.gh/product/
                                    </span>
                                    <input
                                        id="pf-slug"
                                        type="text"
                                        value={urlSlug}
                                        onChange={(e) => { setUrlSlug(e.target.value); setSlugEdited(true); }}
                                        aria-invalid={!!fieldErrors.slug}
                                        className={`flex-1 px-4 py-3 border-2 ${errorBorder('slug')} rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                                        placeholder="product-slug"
                                    />
                                </div>
                                {inputError('slug')}
                            </div>

                            <div>
                                <label htmlFor="pf-keywords" className="block text-sm font-semibold text-gray-900 mb-2">
                                    Keywords
                                </label>
                                <input
                                    id="pf-keywords"
                                    type="text"
                                    value={keywords}
                                    onChange={(e) => setKeywords(e.target.value)}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="keyword1, keyword2"
                                />
                                <p className="text-sm text-gray-500 mt-2">Separate keywords with commas</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
