import mongoose from 'mongoose';
import Provider from '../models/provider/Provider.model.js';
import ServiceRequest from '../models/admin/serviceRequest.model.js';
import dotenv from 'dotenv';
dotenv.config();

const migrateApprovedServices = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        console.log('Fetching all approved service requests...');
        const approvedRequests = await ServiceRequest.find({ status: 'approved' }).lean();
        
        console.log(`Found ${approvedRequests.length} approved requests.`);

        const providerUpdates = {};

        for (const req of approvedRequests) {
            const providerId = req.providerId.toString();
            if (!providerUpdates[providerId]) {
                providerUpdates[providerId] = new Set();
            }
            providerUpdates[providerId].add(req.serviceId.toString());
        }

        console.log(`Updating ${Object.keys(providerUpdates).length} providers...`);

        for (const [providerId, serviceIds] of Object.entries(providerUpdates)) {
            const serviceIdArray = Array.from(serviceIds);
            
            // We also fix the old `services` array by pushing the actual ServiceRequest IDs
            // to replace the old behavior where it pushed Service IDs.
            const requestsForProvider = await ServiceRequest.find({ providerId }).lean();
            const requestIds = requestsForProvider.map(r => r._id.toString());

            await Provider.updateOne(
                { _id: providerId },
                { 
                    $addToSet: { approvedServices: { $each: serviceIdArray } },
                    $set: { services: requestIds } // Fix the old array
                }
            );
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrateApprovedServices();
