import mongoose from 'mongoose';
import { Provider } from '../../models/Provider.model.js';
import { Service } from '../../models/Service.model.js';
import { ServiceCategory } from '../../models/ServiceCategory.model.js';
import { ServiceSubcategory } from '../../models/ServiceSubcategory.model.js';

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

async function assertSubcategoriesForCategory(categoryId, subIds) {
  if (!subIds?.length) {
    return 'At least one service subcategory is required.';
  }
  const unique = [...new Set(subIds.map((id) => String(id)))];
  for (const id of unique) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return 'Invalid subcategory id.';
    }
  }
  const oids = unique.map((id) => new mongoose.Types.ObjectId(id));
  const found = await ServiceSubcategory.find({
    _id: { $in: oids },
    serviceCategory: categoryId,
    isActive: true,
  }).select('_id');
  if (found.length !== unique.length) {
    return 'One or more subcategories are invalid, inactive, or do not belong to this category.';
  }
  return null;
}

function parseDurationMinutes(body) {
  if (body.durationMinutes !== undefined && body.durationMinutes !== null) {
    const n = Number(body.durationMinutes);
    return Number.isFinite(n) ? n : NaN;
  }
  if (body.time !== undefined && body.time !== null) {
    const n = Number(body.time);
    return Number.isFinite(n) ? n : NaN;
  }
  return undefined;
}

function assertProviderCategoryAlignment(provider, categoryId, subIds) {
  if (provider.serviceCategory && String(provider.serviceCategory) !== String(categoryId)) {
    return 'Service category must match your profile service category.';
  }
  const allowed = provider.serviceSubcategories?.length
    ? new Set(provider.serviceSubcategories.map((id) => String(id)))
    : null;
  if (allowed) {
    for (const id of subIds) {
      if (!allowed.has(String(id))) {
        return 'Each subcategory must be one you added on your profile.';
      }
    }
  }
  return null;
}

const populateService = [
  { path: 'serviceCategory', select: 'name slug icon isActive' },
  { path: 'serviceSubcategories', select: 'name icon isActive serviceCategory' },
];

async function getProviderDoc(userId) {
  return Provider.findOne({ userId });
}

export async function createService(req, res) {
  try {
    const provider = await getProviderDoc(req.user._id);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const name = String(req.body.name || '').trim();
    const description = req.body.description != null ? String(req.body.description).trim() : '';
    const categoryId = String(
      req.body.serviceCategory ?? req.body.serviceCategoryId ?? req.body.categoryId ?? ''
    ).trim();
    const rawSubs =
      req.body.serviceSubcategories ?? req.body.serviceSubcategoryIds ?? req.body.subcategoryIds;
    const subIds = Array.isArray(rawSubs) ? rawSubs.map((x) => String(x)) : [];

    if (!name) return badRequest(res, 'Service name is required.');
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return badRequest(res, 'Valid serviceCategory is required.');
    }

    const cat = await ServiceCategory.findOne({ _id: categoryId, isActive: true });
    if (!cat) return badRequest(res, 'Service category not found or inactive.');

    const subErr = await assertSubcategoriesForCategory(categoryId, subIds);
    if (subErr) return badRequest(res, subErr);

    const alignErr = assertProviderCategoryAlignment(provider, categoryId, subIds);
    if (alignErr) return badRequest(res, alignErr);

    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0) {
      return badRequest(res, 'Valid price (number >= 0) is required.');
    }

    const duration = parseDurationMinutes(req.body);
    if (duration === undefined || !Number.isFinite(duration) || duration < 1) {
      return badRequest(res, 'Valid time is required (duration in minutes: use time or durationMinutes, min 1).');
    }

    const doc = await Service.create({
      provider: provider._id,
      serviceCategory: categoryId,
      serviceSubcategories: subIds.map((id) => new mongoose.Types.ObjectId(id)),
      name,
      price,
      durationMinutes: duration,
      description,
    });

    const populated = await Service.findById(doc._id).populate(populateService);
    return res.status(201).json({ success: true, data: { service: populated } });
  } catch (err) {
    console.error('createService:', err);
    return res.status(500).json({ success: false, message: err.message || 'Create failed.' });
  }
}

export async function listMyServices(req, res) {
  try {
    const provider = await getProviderDoc(req.user._id);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const onlyActive = req.query.onlyActive !== 'false';
    const filter = { provider: provider._id };
    if (onlyActive) filter.isActive = true;

    const list = await Service.find(filter).sort({ updatedAt: -1 }).populate(populateService);
    return res.json({ success: true, data: { services: list } });
  } catch (err) {
    console.error('listMyServices:', err);
    return res.status(500).json({ success: false, message: err.message || 'List failed.' });
  }
}

export async function getService(req, res) {
  try {
    const provider = await getProviderDoc(req.user._id);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const svc = await Service.findOne({
      _id: req.params.id,
      provider: provider._id,
    }).populate(populateService);

    if (!svc) {
      return res.status(404).json({ success: false, message: 'Service not found.' });
    }
    return res.json({ success: true, data: { service: svc } });
  } catch (err) {
    console.error('getService:', err);
    return res.status(500).json({ success: false, message: err.message || 'Request failed.' });
  }
}

export async function updateService(req, res) {
  try {
    const provider = await getProviderDoc(req.user._id);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const svc = await Service.findOne({ _id: req.params.id, provider: provider._id });
    if (!svc) {
      return res.status(404).json({ success: false, message: 'Service not found.' });
    }

    let categoryId = String(svc.serviceCategory);

    const categoryInput =
      req.body.serviceCategory !== undefined ||
      req.body.serviceCategoryId !== undefined ||
      req.body.categoryId !== undefined;

    if (categoryInput) {
      categoryId = String(
        req.body.serviceCategory ?? req.body.serviceCategoryId ?? req.body.categoryId ?? ''
      ).trim();
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return badRequest(res, 'Invalid serviceCategory.');
      }
      const cat = await ServiceCategory.findOne({ _id: categoryId, isActive: true });
      if (!cat) return badRequest(res, 'Service category not found or inactive.');
      svc.serviceCategory = categoryId;
    }

    const rawSubs =
      req.body.serviceSubcategories ?? req.body.serviceSubcategoryIds ?? req.body.subcategoryIds;
    let subIds = svc.serviceSubcategories.map((id) => String(id));
    if (rawSubs !== undefined) {
      subIds = Array.isArray(rawSubs) ? rawSubs.map((x) => String(x)) : [];
      const subErr = await assertSubcategoriesForCategory(categoryId, subIds);
      if (subErr) return badRequest(res, subErr);
      svc.serviceSubcategories = subIds.map((id) => new mongoose.Types.ObjectId(id));
    } else if (categoryInput) {
      const subErr = await assertSubcategoriesForCategory(categoryId, subIds);
      if (subErr) {
        return badRequest(
          res,
          `${subErr} Send serviceSubcategories that belong to the new category.`
        );
      }
    }

    const alignErr = assertProviderCategoryAlignment(provider, categoryId, subIds);
    if (alignErr) return badRequest(res, alignErr);

    if (req.body.name != null) {
      const n = String(req.body.name).trim();
      if (!n) return badRequest(res, 'Name cannot be empty.');
      svc.name = n;
    }
    if (req.body.description !== undefined) {
      svc.description = String(req.body.description || '').trim();
    }
    if (req.body.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) {
        return badRequest(res, 'Valid price (number >= 0) is required.');
      }
      svc.price = price;
    }
    const duration = parseDurationMinutes(req.body);
    if (duration !== undefined) {
      if (!Number.isFinite(duration) || duration < 1) {
        return badRequest(res, 'time / durationMinutes must be a number >= 1.');
      }
      svc.durationMinutes = duration;
    }
    if (req.body.isActive !== undefined) {
      svc.isActive = Boolean(req.body.isActive);
    }

    await svc.save();
    const populated = await Service.findById(svc._id).populate(populateService);
    return res.json({ success: true, data: { service: populated } });
  } catch (err) {
    console.error('updateService:', err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed.' });
  }
}

export async function deleteService(req, res) {
  try {
    const provider = await getProviderDoc(req.user._id);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const svc = await Service.findOneAndDelete({ _id: req.params.id, provider: provider._id });
    if (!svc) {
      return res.status(404).json({ success: false, message: 'Service not found.' });
    }
    return res.json({ success: true, message: 'Service deleted.' });
  } catch (err) {
    console.error('deleteService:', err);
    return res.status(500).json({ success: false, message: err.message || 'Delete failed.' });
  }
}

