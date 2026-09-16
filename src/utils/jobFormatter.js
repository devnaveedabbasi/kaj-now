import ServiceRequest from '../models/admin/serviceRequest.model.js';

/**
 * Bulk-fetches all approved ServiceRequests referenced by a list of jobs.
 * Template-based jobs (BD, or UK against an admin template) are looked up by
 * their (serviceId, providerId) pair, same as before. A custom UK job has no
 * `service` at all — those are looked up by the job's own `serviceRequestId`
 * instead, and stored under a distinct `sr_<id>` key so the two lookup
 * schemes never collide.
 * @param {Array|Object} jobs - A single job object/document or an array of jobs.
 * @returns {Promise<Map>} Map mapping `${serviceId}_${providerId}` -> ServiceRequest,
 *   plus `sr_${serviceRequestId}` -> ServiceRequest for jobs with no `service`.
 */
export async function getServiceDetailsForJobs(jobs) {
  const jobsList = Array.isArray(jobs) ? jobs : [jobs];

  const serviceIds = jobsList.map(j => j.service?._id || j.service).filter(Boolean);
  const providerIds = jobsList.map(j => j.provider?._id || j.provider).filter(Boolean);
  // Custom jobs (no `service`) still carry serviceRequestId — that's their
  // only way back to ukService's title/price/etc.
  const customRequestIds = jobsList
    .filter(j => !(j.service?._id || j.service))
    .map(j => j.serviceRequestId?._id || j.serviceRequestId)
    .filter(Boolean);

  const srMap = new Map();

  if (serviceIds.length > 0 && providerIds.length > 0) {
    const serviceRequests = await ServiceRequest.find({
      serviceId: { $in: serviceIds },
      providerId: { $in: providerIds },
      status: 'approved'
    }).lean();

    serviceRequests.forEach(sr => {
      if (Array.isArray(sr.serviceId)) {
        sr.serviceId.forEach(sId => {
          srMap.set(`${sId.toString()}_${sr.providerId.toString()}`, sr);
        });
      } else if (sr.serviceId) {
        srMap.set(`${sr.serviceId.toString()}_${sr.providerId.toString()}`, sr);
      }
    });
  }

  if (customRequestIds.length > 0) {
    const customRequests = await ServiceRequest.find({
      _id: { $in: customRequestIds },
      isCustomService: true,
    }).lean();

    customRequests.forEach(sr => {
      srMap.set(`sr_${sr._id.toString()}`, sr);
    });
  }

  return srMap;
}

/**
 * Merges a job's template service details with its provider-specific ServiceRequest approved listing.
 * Handles region check (UK vs BD) to dynamically fall back to template or custom properties.
 * A custom UK service has no backing Service document at all — pass the
 * job's own `jobServiceRequestId` so this can still build a full result from
 * `ukService` alone in that case (`service` will be null/undefined).
 * @param {Object} service - The populated service object from the job (null for a custom UK service).
 * @param {ObjectId|String|Object} providerId - The provider's ID.
 * @param {String} [customerRegion] - Optional region derived from the customer (e.g. 'UK', 'BD').
 * @param {Map} srMap - The ServiceRequest map returned by getServiceDetailsForJobs.
 * @param {ObjectId|String} [jobServiceRequestId] - The job's own serviceRequestId — required to resolve a custom (no-`service`) job.
 * @returns {Object} The formatted service sub-object.
 */
export function formatServiceDetails(service, providerId, customerRegion, srMap, jobServiceRequestId) {
  if (!service) {
    if (!jobServiceRequestId) return null;

    const serviceRequest = srMap?.get(`sr_${jobServiceRequestId.toString()}`) || null;
    const uk = serviceRequest?.ukService;
    if (!uk) return null;

    return {
      _id: jobServiceRequestId,
      name: uk.title || null,
      icon: null,
      serviceImage: uk.serviceImage || null,
      price: uk.price ?? 0,
      description: uk.description || null,
      // Same default a real Service document gets — no backing Service doc
      // exists for a custom service to carry a real one.
      averageRating: 3,
      subServices: uk.subServices || [],
      estimatedTime: uk.estimatedTime || null,
    };
  }

  const sId = service._id || service;
  const pId = providerId?._id || providerId;

  const key = `${sId.toString()}_${pId.toString()}`;
  const serviceRequest = srMap?.get(key) || null;

  const isUK = service.region === 'UK' || customerRegion === 'UK' || serviceRequest?.region === 'UK';

  const name = (isUK && serviceRequest?.ukService?.title)
    ? serviceRequest.ukService.title
    : (service.name || null);

  const serviceImage = (isUK && serviceRequest?.ukService?.serviceImage)
    ? serviceRequest.ukService.serviceImage
    : (service.serviceImage || null);

  const price = (isUK && serviceRequest?.ukService?.price !== undefined)
    ? serviceRequest.ukService.price
    : (service.price || 0);

  const description = (isUK && serviceRequest?.ukService?.description)
    ? serviceRequest.ukService.description
    : (service.description || null);

  const subServices = (isUK && serviceRequest?.ukService?.subServices)
    ? serviceRequest.ukService.subServices
    : (service.subServices || []);

  const estimatedTime = (isUK && serviceRequest?.ukService?.estimatedTime)
    ? serviceRequest.ukService.estimatedTime
    : (service.estimatedTime || null);

  return {
    _id: sId,
    name,
    icon: service.icon || null,
    serviceImage,
    price,
    description,
    averageRating: service.averageRating || 0,
    subServices,
    estimatedTime,
  };
}
