import { ServiceCategory } from '../../models/ServiceCategory.model.js';
import { ServiceSubcategory } from '../../models/ServiceSubcategory.model.js';

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

function parseIcon(body) {
  if (body.icon === undefined || body.icon === null) return undefined;
  return String(body.icon).trim();
}

function attachSubcategories(categories, subcategories) {
  const byCat = {};
  for (const s of subcategories) {
    const k = String(s.serviceCategory);
    if (!byCat[k]) byCat[k] = [];
    byCat[k].push(s);
  }
  return categories.map((c) => ({
    ...c,
    subcategories: byCat[String(c._id)] || [],
  }));
}

/** Public: active categories with active subcategories (for provider signup / profile). */
export async function listActiveCategories(req, res) {
  try {
    const categories = await ServiceCategory.find({ isActive: true }).sort({ name: 1 }).lean();
    const catIds = categories.map((c) => c._id);
    const subs = await ServiceSubcategory.find({
      serviceCategory: { $in: catIds },
      isActive: true,
    })
      .sort({ name: 1 })
      .lean();
    const data = attachSubcategories(categories, subs);
    return res.json({ success: true, data: { categories: data } });
  } catch (err) {
    console.error('listActiveCategories:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to list categories.' });
  }
}

/** Admin: all categories (optional ?includeInactive=false only active). */
export async function adminListCategories(req, res) {
  try {
    const onlyActive = req.query.onlyActive === 'true';
    const filter = onlyActive ? { isActive: true } : {};
    const categories = await ServiceCategory.find(filter).sort({ name: 1 }).lean();
    const catIds = categories.map((c) => c._id);
    const subFilter = { serviceCategory: { $in: catIds } };
    if (onlyActive) subFilter.isActive = true;
    const subs = await ServiceSubcategory.find(subFilter).sort({ name: 1 }).lean();
    const data = attachSubcategories(categories, subs);
    return res.json({ success: true, data: { categories: data } });
  } catch (err) {
    console.error('adminListCategories:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to list categories.' });
  }
}

export async function adminCreateCategory(req, res) {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return badRequest(res, 'Name is required.');
    const slug = req.body.slug != null ? String(req.body.slug).trim() : undefined;
    const description =
      req.body.description != null ? String(req.body.description).trim() : '';
    const icon = parseIcon(req.body);
    const doc = await ServiceCategory.create({
      name,
      slug: slug || undefined,
      description,
      ...(icon !== undefined ? { icon } : {}),
    });
    return res.status(201).json({ success: true, data: { category: doc } });
  } catch (err) {
    console.error('adminCreateCategory:', err);
    return res.status(500).json({ success: false, message: err.message || 'Create failed.' });
  }
}

export async function adminUpdateCategory(req, res) {
  try {
    const id = req.params.id;
    const cat = await ServiceCategory.findById(id);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
    if (req.body.name != null) cat.name = String(req.body.name).trim();
    if (req.body.slug !== undefined) cat.slug = req.body.slug ? String(req.body.slug).trim() : undefined;
    if (req.body.description !== undefined) cat.description = String(req.body.description || '').trim();
    if (req.body.icon !== undefined) cat.icon = parseIcon(req.body) ?? '';
    if (req.body.isActive !== undefined) cat.isActive = Boolean(req.body.isActive);
    await cat.save();
    return res.json({ success: true, data: { category: cat } });
  } catch (err) {
    console.error('adminUpdateCategory:', err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed.' });
  }
}

export async function adminCreateSubcategory(req, res) {
  try {
    const categoryId = req.params.categoryId;
    const cat = await ServiceCategory.findById(categoryId);
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
    const name = String(req.body.name || '').trim();
    if (!name) return badRequest(res, 'Name is required.');
    const icon = parseIcon(req.body);
    const doc = await ServiceSubcategory.create({
      serviceCategory: categoryId,
      name,
      ...(icon !== undefined ? { icon } : {}),
    });
    return res.status(201).json({ success: true, data: { subcategory: doc } });
  } catch (err) {
    console.error('adminCreateSubcategory:', err);
    return res.status(500).json({ success: false, message: err.message || 'Create failed.' });
  }
}

export async function adminUpdateSubcategory(req, res) {
  try {
    const id = req.params.id;
    const sub = await ServiceSubcategory.findById(id);
    if (!sub) return res.status(404).json({ success: false, message: 'Subcategory not found.' });
    if (req.body.name != null) sub.name = String(req.body.name).trim();
    if (req.body.icon !== undefined) sub.icon = parseIcon(req.body) ?? '';
    if (req.body.isActive !== undefined) sub.isActive = Boolean(req.body.isActive);
    await sub.save();
    return res.json({ success: true, data: { subcategory: sub } });
  } catch (err) {
    console.error('adminUpdateSubcategory:', err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed.' });
  }
}

