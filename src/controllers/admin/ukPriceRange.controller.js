import UkPriceRange from '../../models/admin/ukPriceRange.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

const validateRange = (minPrice, maxPrice) => {
    if (minPrice === undefined || minPrice === '' || maxPrice === undefined || maxPrice === '') {
        throw new ApiError(400, 'minPrice and maxPrice are required');
    }
    if (Number(minPrice) < 0 || Number(maxPrice) < 0) {
        throw new ApiError(400, 'minPrice and maxPrice cannot be negative');
    }
    if (Number(minPrice) > Number(maxPrice)) {
        throw new ApiError(400, 'minPrice cannot be greater than maxPrice');
    }
};

// POST /admin/uk-price-range — create the (single) UK price range
export const createUkPriceRange = async (req, res) => {
    const { minPrice, maxPrice } = req.body;
    validateRange(minPrice, maxPrice);

    const existing = await UkPriceRange.findOne({ region: 'UK' });
    if (existing) {
        throw new ApiError(409, 'UK price range already exists — use update instead');
    }

    const created = await UkPriceRange.create({
        region: 'UK',
        minPrice: Number(minPrice),
        maxPrice: Number(maxPrice),
        updatedBy: req.user._id,
    });

    res.status(201).json(new ApiResponse(201, created, 'UK price range created successfully'));
};

// GET /admin/uk-price-range
export const getUkPriceRange = async (req, res) => {
    const range = await UkPriceRange.findOne({ region: 'UK' });
    if (!range) {
        throw new ApiError(404, 'UK price range not set yet');
    }
    res.status(200).json(new ApiResponse(200, range, 'UK price range retrieved successfully'));
};

// PUT /admin/uk-price-range
export const updateUkPriceRange = async (req, res) => {
    const { minPrice, maxPrice } = req.body;

    const existing = await UkPriceRange.findOne({ region: 'UK' });
    if (!existing) {
        throw new ApiError(404, 'UK price range not set yet — create it first');
    }

    const effectiveMinPrice = minPrice !== undefined && minPrice !== '' ? Number(minPrice) : existing.minPrice;
    const effectiveMaxPrice = maxPrice !== undefined && maxPrice !== '' ? Number(maxPrice) : existing.maxPrice;
    validateRange(effectiveMinPrice, effectiveMaxPrice);

    existing.minPrice = effectiveMinPrice;
    existing.maxPrice = effectiveMaxPrice;
    existing.updatedBy = req.user._id;
    await existing.save();

    res.status(200).json(new ApiResponse(200, existing, 'UK price range updated successfully'));
};

// DELETE /admin/uk-price-range
export const deleteUkPriceRange = async (req, res) => {
    const deleted = await UkPriceRange.findOneAndDelete({ region: 'UK' });
    if (!deleted) {
        throw new ApiError(404, 'UK price range not set');
    }
    res.status(200).json(new ApiResponse(200, null, 'UK price range deleted successfully'));
};
