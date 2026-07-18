import User from '../models/User.model.js';
import Provider from '../models/provider/Provider.model.js';

// Jobs/Payments/Withdrawals carry no `region` field of their own — region is
// always derived from the linked customer's (or provider's) User.region.
// These helpers centralize that lookup so every admin financial endpoint
// filters the same way (mirrors the inline pattern already used throughout
// admin/wallet.controller.js and admin/job.controller.js).

export const REGION_CURRENCY = { UK: 'GBP', BD: 'BDT' };

export function isValidRegion(region) {
  return region === 'UK' || region === 'BD';
}

export async function getRegionCustomerIds(region) {
  const users = await User.find({ region }).select('_id').lean();
  return users.map((u) => u._id);
}

export async function getRegionProviderIds(region) {
  const regionUsers = await User.find({ region, role: 'provider' }).select('_id').lean();
  const regionProviders = await Provider.find({ userId: { $in: regionUsers.map((u) => u._id) } })
    .select('_id')
    .lean();
  return regionProviders.map((p) => p._id);
}
