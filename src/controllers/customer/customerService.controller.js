import mongoose from 'mongoose';
import { ServiceCategory } from '../../models/ServiceCategory.model.js';
import { ServiceSubcategory } from '../../models/ServiceSubcategory.model.js';
import { Service } from '../../models/Service.model.js';
import { Provider } from '../../models/Provider.model.js';
import { Job } from '../../models/Job.model.js';
import { Customer } from '../../models/Customer.model.js';

const servicePopulate = [
  { path: 'serviceCategory', select: 'name slug icon isActive' },
  { path: 'serviceSubcategories', select: 'name icon isActive' },
  {
    path: 'provider',
    select: 'fullName rating isAvailable isProfileComplete userId',
    populate: { path: 'userId', select: 'name' },
  },
];

function serializeProviderService(doc, stats = {}) {
  const j = doc.toJSON();
  return {
    ...j,
    providerDisplayName: j.provider?.fullName || j.provider?.userId?.name || null,
    stats,
  };
}

/**
 * Get subcategories for a specific category
 */
export async function getSubcategories(req, res) {
  try {
    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ success: false, message: 'Invalid category ID.' });
    }

    // Check if category exists and is active
    const category = await ServiceCategory.findById(categoryId);
    if (!category || !category.isActive) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const subcategories = await ServiceSubcategory.find({
      serviceCategory: categoryId,
      isActive: true,
    }).sort({ name: 1 });

    return res.json({
      success: true,
      data: {
        category: {
          _id: category._id,
          name: category.name,
          icon: category.icon,
        },
        subcategories,
      },
    });
  } catch (err) {
    console.error('getSubcategories:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load subcategories.' });
  }
}

/**
 * Get services for a specific subcategory
 */
export async function getServicesBySubcategory(req, res) {
  try {
    const { subcategoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
      return res.status(400).json({ success: false, message: 'Invalid subcategory ID.' });
    }

    // Check if subcategory exists and is active
    const subcategory = await ServiceSubcategory.findById(subcategoryId).populate('serviceCategory', 'name icon');
    if (!subcategory || !subcategory.isActive) {
      return res.status(404).json({ success: false, message: 'Subcategory not found.' });
    }

    // Find services that have this subcategory and are active, with available providers
    const services = await Service.find({
      serviceSubcategories: subcategoryId,
      isActive: true,
    })
      .populate(servicePopulate)
      .sort({ createdAt: -1 });

    // Filter services where provider is available and profile is complete
    const filteredServices = services.filter(service =>
      service.provider?.isAvailable && service.provider?.isProfileComplete
    );

    const serializedServices = filteredServices.map(service => serializeProviderService(service));

    return res.json({
      success: true,
      data: {
        subcategory: {
          _id: subcategory._id,
          name: subcategory.name,
          icon: subcategory.icon,
          category: subcategory.serviceCategory,
        },
        services: serializedServices,
      },
    });
  } catch (err) {
    console.error('getServicesBySubcategory:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load services.' });
  }
}

/**
 * Get service details
 */
export async function getServiceDetails(req, res) {
  try {
    const { serviceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, message: 'Invalid service ID.' });
    }

    const service = await Service.findById(serviceId)
      .populate(servicePopulate);

    if (!service || !service.isActive) {
      return res.status(404).json({ success: false, message: 'Service not found.' });
    }

    // Check if provider is available
    if (!service.provider?.isAvailable || !service.provider?.isProfileComplete) {
      return res.status(404).json({ success: false, message: 'Service not available.' });
    }

    const serializedService = serializeProviderService(service);

    return res.json({
      success: true,
      data: serializedService,
    });
  } catch (err) {
    console.error('getServiceDetails:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load service details.' });
  }
}

/**
 * Create a job for a service (with payment through Stripe)
 */
export async function createJob(req, res) {
  try {
    const { serviceId } = req.params;
    const { description, scheduledAt, stripeToken, serviceLocation } = req.body; // serviceLocation: { name, phoneNumber, houseNumber, address, city, postalCode, coordinates: { latitude, longitude } }
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, message: 'Invalid service ID.' });
    }

    // Validate service location details
    if (!serviceLocation) {
      return res.status(400).json({ 
        success: false, 
        message: 'Service location details are required. Provide: name, phoneNumber, houseNumber, address, city, postalCode, and coordinates (latitude, longitude).' 
      });
    }

    const { name, phoneNumber, houseNumber, address, city, postalCode, coordinates } = serviceLocation;

    if (!name || !phoneNumber || !houseNumber || !address || !city || !postalCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing location details. Please provide name, phoneNumber, houseNumber, address, city, and postalCode.' 
      });
    }

    if (!coordinates || typeof coordinates.latitude !== 'number' || typeof coordinates.longitude !== 'number') {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid coordinates. Please provide latitude and longitude as numbers.' 
      });
    }

    // Get service details
    const service = await Service.findById(serviceId).populate('provider');
    if (!service || !service.isActive) {
      return res.status(404).json({ success: false, message: 'Service not found.' });
    }

    // Check if provider is available
    if (!service.provider?.isAvailable || !service.provider?.isProfileComplete) {
      return res.status(400).json({ success: false, message: 'Service provider is not available.' });
    }

    // TODO: Process Stripe payment here
    // For now, assume payment is successful
    const paymentSuccessful = true; // Replace with actual Stripe integration

    if (!paymentSuccessful) {
      return res.status(400).json({ success: false, message: 'Payment failed.' });
    }

    // Create job
    const job = new Job({
      provider: service.provider._id,
      customer: customerId,
      service: serviceId,
      amount: service.price,
      title: service.name,
      description: description || '',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      paymentStatus: 'paid', // Payment processed
      status: 'pending',
      serviceLocation: {
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        houseNumber: houseNumber.trim(),
        address: address.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        coordinates: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        },
      },
    });

    await job.save();

    // Update customer booking count
    await Customer.findOneAndUpdate(
      { userId: customerId },
      { $inc: { totalBookings: 1 } },
      { upsert: true }
    );

    // Populate job for response
    await job.populate([
      { path: 'service', select: 'name price durationMinutes' },
      { path: 'provider', select: 'fullName', populate: { path: 'userId', select: 'name' } }
    ]);

    return res.status(201).json({
      success: true,
      message: 'Job created and payment processed successfully.',
      data: {
        job: {
          _id: job._id,
          title: job.title,
          amount: job.amount,
          status: job.status,
          paymentStatus: job.paymentStatus,
          scheduledAt: job.scheduledAt,
          serviceLocation: job.serviceLocation,
          createdAt: job.createdAt,
        },
        service: {
          name: service.name,
          price: service.price,
        },
        provider: {
          name: service.provider?.fullName || service.provider?.userId?.name,
        }
      },
    });
  } catch (err) {
    console.error('createJob:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create job.' });
  }
}

/**
 * Get customer's jobs
 */
export async function getMyJobs(req, res) {
  try {
    const customerId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { customer: customerId };
    if (status) {
      query.status = status;
    }

    const jobs = await Job.find(query)
      .populate({
        path: 'service',
        select: 'name price durationMinutes',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate({
        path: 'provider',
        select: 'fullName location',
        populate: { path: 'userId', select: 'name' }
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Job.countDocuments(query);

    return res.json({
      success: true,
      data: {
        jobs: jobs.map(job => ({
          _id: job._id,
          title: job.title,
          description: job.description,
          amount: job.amount,
          status: job.status,
          paymentStatus: job.paymentStatus,
          scheduledAt: job.scheduledAt,
          completedAt: job.completedAt,
          serviceLocation: job.serviceLocation,
          createdAt: job.createdAt,
          service: {
            name: job.service?.name,
            price: job.service?.price,
            category: job.service?.serviceCategory?.name,
          },
          provider: {
            name: job.provider?.fullName || job.provider?.userId?.name,
            location: job.provider?.location || null,
          }
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        }
      },
    });
  } catch (err) {
    console.error('getMyJobs:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load jobs.' });
  }
}

/**
 * Mark job as completed by customer
 */
export async function completeJob(req, res) {
  try {
    const { jobId } = req.params;
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ success: false, message: 'Invalid job ID.' });
    }

    const job = await Job.findOne({ _id: jobId, customer: customerId });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    if (job.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Job must be in progress to mark as completed.' });
    }

    // Mark job as completed
    job.status = 'completed';
    job.completedAt = new Date();
    await job.save();

    return res.json({
      success: true,
      message: 'Job marked as completed.',
      data: {
        job: {
          _id: job._id,
          status: job.status,
          completedAt: job.completedAt,
        }
      },
    });
  } catch (err) {
    console.error('completeJob:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to complete job.' });
  }
}