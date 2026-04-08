import mongoose from 'mongoose';
import { ServiceCategory } from '../../models/ServiceCategory.model.js';
import { ServiceSubcategory } from '../../models/ServiceSubcategory.model.js';
import { Service } from '../../models/Service.model.js';
import { Job } from '../../models/Job.model.js';

const DEFAULT_SECTION_LIMIT = 12;
const MIN_SECTION_LIMIT = 6;
const MAX_SECTION_LIMIT = 24;

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

async function loadAdminCategories() {
  const categories = await ServiceCategory.find({ isActive: true }).sort({ name: 1 }).lean();
  const catIds = categories.map((c) => c._id);
  const subs = await ServiceSubcategory.find({
    serviceCategory: { $in: catIds },
    isActive: true,
  })
    .sort({ name: 1 })
    .lean();
  return attachSubcategories(categories, subs);
}

const servicePopulate = [
  { path: 'serviceCategory', select: 'name slug icon isActive' },
  { path: 'serviceSubcategories', select: 'name icon isActive' },
  {
    path: 'provider',
    select: 'fullName rating isAvailable isProfileComplete userId',
    populate: { path: 'userId', select: 'name' },
  },
];

function toObjectIds(idSet) {
  return [...idSet].map((id) => new mongoose.Types.ObjectId(String(id)));
}

async function fetchServicesInOrder(ids) {
  if (!ids.length) return [];
  const docs = await Service.find({
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) },
    isActive: true,
  }).populate(servicePopulate);
  const map = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => map.get(String(id))).filter(Boolean);
}

function serializeProviderService(doc, stats = {}) {
  const j = doc.toJSON();
  return {
    ...j,
    providerDisplayName: j.provider?.fullName || j.provider?.userId?.name || null,
    stats,
  };
}

async function rankedServiceIds(excludeIds, limit, { requireProfileComplete } = {}) {
  if (limit <= 0) return [];
  const exclude = excludeIds.length ? toObjectIds(new Set(excludeIds.map(String))) : [];
  const matchP = { 'p.isAvailable': true };
  if (requireProfileComplete) matchP['p.isProfileComplete'] = true;

  const rows = await Service.aggregate([
    {
      $match: {
        isActive: true,
        ...(exclude.length ? { _id: { $nin: exclude } } : {}),
      },
    },
    {
      $lookup: {
        from: 'providers',
        localField: 'provider',
        foreignField: '_id',
        as: 'p',
      },
    },
    { $unwind: '$p' },
    { $match: matchP },
    { $sort: { 'p.rating': -1, updatedAt: -1 } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);
  return rows.map((r) => r._id);
}

async function buildPopularServices(limit) {
  const agg = await Job.aggregate([
    {
      $match: {
        status: 'completed',
        service: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$service',
        completedJobsCount: { $sum: 1 },
      },
    },
    { $sort: { completedJobsCount: -1 } },
    { $limit: limit },
  ]);

  const order = agg.map((r) => r._id);
  const countById = new Map(agg.map((r) => [String(r._id), r.completedJobsCount]));

  let docs = await fetchServicesInOrder(order);
  let out = docs.map((doc) =>
    serializeProviderService(doc, {
      completedJobsCount: countById.get(String(doc._id)) ?? 0,
    })
  );

  const used = new Set(out.map((s) => String(s._id)));
  if (out.length < limit) {
    const moreIds = await rankedServiceIds([...used], limit - out.length, {
      requireProfileComplete: false,
    });
    const moreDocs = await fetchServicesInOrder(moreIds);
    for (const doc of moreDocs) {
      if (used.has(String(doc._id))) continue;
      used.add(String(doc._id));
      out.push(
        serializeProviderService(doc, {
          completedJobsCount: 0,
        })
      );
      if (out.length >= limit) break;
    }
  }

  return out.slice(0, limit);
}

async function buildRecommendedServices(limit, excludeIdSet) {
  const exclude = excludeIdSet.size ? toObjectIds(excludeIdSet) : [];

  let rows = await Service.aggregate([
    {
      $match: {
        isActive: true,
        ...(exclude.length ? { _id: { $nin: exclude } } : {}),
      },
    },
    {
      $lookup: {
        from: 'providers',
        localField: 'provider',
        foreignField: '_id',
        as: 'p',
      },
    },
    { $unwind: '$p' },
    {
      $match: {
        'p.isAvailable': true,
        'p.isProfileComplete': true,
      },
    },
    { $sort: { 'p.rating': -1, updatedAt: -1 } },
    { $limit: limit },
    { $project: { _id: 1, pr: '$p.rating' } },
  ]);

  let ids = rows.map((r) => r._id);
  let ratingById = new Map(rows.map((r) => [String(r._id), r.pr ?? 0]));

  if (ids.length < limit) {
    const used = new Set([...excludeIdSet].map(String));
    rows.forEach((r) => used.add(String(r._id)));
    const moreIds = await rankedServiceIds([...used], limit - ids.length, {
      requireProfileComplete: false,
    });
    for (const mid of moreIds) {
      if (used.has(String(mid))) continue;
      used.add(String(mid));
      ids.push(mid);
      ratingById.set(String(mid), 0);
      if (ids.length >= limit) break;
    }
  }

  const docs = await fetchServicesInOrder(ids.slice(0, limit));
  return docs.map((doc) =>
    serializeProviderService(doc, {
      providerRating: ratingById.get(String(doc._id)) ?? doc.provider?.rating ?? 0,
    })
  );
}

function clampLimit(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), MIN_SECTION_LIMIT), MAX_SECTION_LIMIT);
}

/**
 * Customer home: admin categories (browse) + popular & recommended provider services.
 */
export async function getHome(req, res) {
  try {
    const popularLimit = clampLimit(req.query.popularLimit, DEFAULT_SECTION_LIMIT);
    const recommendedLimit = clampLimit(req.query.recommendedLimit, DEFAULT_SECTION_LIMIT);

    const [categories, popularServices] = await Promise.all([
      loadAdminCategories(),
      buildPopularServices(popularLimit),
    ]);

    const popularIdSet = new Set(popularServices.map((s) => String(s._id)));
    const recommendedServices = await buildRecommendedServices(recommendedLimit, popularIdSet);

    return res.json({
      success: true,
      data: {
        categories,
        popularServices,
        recommendedServices,
      },
    });
  } catch (err) {
    console.error('customer home:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load home.' });
  }
}

