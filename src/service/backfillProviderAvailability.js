// One-off migration: gives every provider created before Provider.availability
// had a schema default (all days, 09:00-18:00) that same default, so they
// don't sit permanently blank. Only touches providers who never set ANY days
// themselves — anyone with at least one day already set is left untouched,
// even if their start/end time happen to be blank (assumed deliberate).
import mongoose from 'mongoose';
import Provider from '../models/provider/Provider.model.js';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '18:00';

const backfillProviderAvailability = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const filter = {
            $or: [
                { availability: { $exists: false } },
                { 'availability.days': { $exists: false } },
                { 'availability.days': { $size: 0 } },
            ],
        };

        const matchCount = await Provider.countDocuments(filter);
        console.log(`Found ${matchCount} providers with no availability set.`);

        if (matchCount === 0) {
            console.log('Nothing to backfill.');
            process.exit(0);
        }

        const result = await Provider.updateMany(filter, {
            $set: {
                'availability.days': DEFAULT_DAYS,
                'availability.startTime': DEFAULT_START_TIME,
                'availability.endTime': DEFAULT_END_TIME,
            },
        });

        console.log(`Backfilled ${result.modifiedCount} providers.`);
        process.exit(0);
    } catch (error) {
        console.error('Backfill failed:', error);
        process.exit(1);
    }
};

backfillProviderAvailability();
