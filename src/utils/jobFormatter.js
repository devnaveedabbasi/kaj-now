import ServiceRequest from '../models/admin/serviceRequest.model.js';

/**
 * Bulk-fetches all approved ServiceRequests matching the service and provider IDs from a list of jobs.
 * Returns a Map keyed by `${serviceId}_${providerId}` for easy O(1) lookups.
 * @param {Array|Object} jobs - A single job object/document or an array of jobs.
 * @returns {Promise<Map>} Map mapping `${serviceId}_${providerId}` -> approved ServiceRequest
 */
export async function getServiceDetailsForJobs(jobs) {
  const jobsList = Array.isArray(jobs) ? jobs : [jobs];

  const serviceIds = jobsList.map(j => j.service?._id || j.service).filter(Boolean);
  const providerIds = jobsList.map(j => j.provider?._id || j.provider).filter(Boolean);

  if (serviceIds.length === 0 || providerIds.length === 0) {
    return new Map();
  }

  const serviceRequests = await ServiceRequest.find({
    serviceId: { $in: serviceIds },
    providerId: { $in: providerIds },
    status: 'approved'
  }).lean();

  const srMap = new Map();
  serviceRequests.forEach(sr => {
    if (Array.isArray(sr.serviceId)) {
      sr.serviceId.forEach(sId => {
        srMap.set(`${sId.toString()}_${sr.providerId.toString()}`, sr);
      });
    } else if (sr.serviceId) {
      srMap.set(`${sr.serviceId.toString()}_${sr.providerId.toString()}`, sr);
    }
  });

  return srMap;
}

/**
 * Merges a job's template service details with its provider-specific ServiceRequest approved listing.
 * Handles region check (UK vs BD) to dynamically fall back to template or custom properties.
 * @param {Object} service - The populated service object from the job.
 * @param {ObjectId|String|Object} providerId - The provider's ID.
 * @param {String} [customerRegion] - Optional region derived from the customer (e.g. 'UK', 'BD').
 * @param {Map} srMap - The ServiceRequest map returned by getServiceDetailsForJobs.
 * @returns {Object} The formatted service sub-object.
 */
export function formatServiceDetails(service, providerId, customerRegion, srMap) {
  if (!service) return null;

  const sId = service._id || service;
  const pId = providerId?._id || providerId;

  const key = `${sId.toString()}_${pId.toString()}`;
  const serviceRequest = srMap?.get(key) || null;

  const isUK = customerRegion === 'UK' || serviceRequest?.region === 'UK';

  const name = (isUK && serviceRequest?.ukService?.title)
    ? serviceRequest.ukService.title
    : service.name;

  const serviceImage = (isUK && serviceRequest?.ukService?.serviceImage)
    ? serviceRequest.ukService.serviceImage
    : service.serviceImage;

  const price = (isUK && serviceRequest?.ukService?.price !== undefined)
    ? serviceRequest.ukService.price
    : service.price;

  const description = (isUK && serviceRequest?.ukService?.description)
    ? serviceRequest.ukService.description
    : service.description;

  const subServices = (isUK && serviceRequest?.ukService?.subServices)
    ? serviceRequest.ukService.subServices
    : (service.subServices || []);

  const estimatedTime = (isUK && serviceRequest?.ukService?.estimatedTime)
    ? serviceRequest.ukService.estimatedTime
    : (service.estimatedTime || null);

  const availability = (isUK && serviceRequest?.ukService?.availability)
    ? serviceRequest.ukService.availability
    : (service.availability || []);

  return {
    _id: sId,
    name,
    icon: service.icon,
    serviceImage,
    price,
    description,
    averageRating: service.averageRating || 0,
    subServices,
    estimatedTime,
    availability
  };
}
