import Review from '../../models/reviews.model.js';
import Service from '../../models/admin/service.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import mongoose from 'mongoose';

export const createReview = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const { rating, comment } = req.body;
        const userId = req.user._id;

        // Validate rating
        const finalRating = rating !== undefined ? rating : 3;
        
        if (finalRating < 1 || finalRating > 5) {
            throw new ApiError(400, 'Rating must be between 1 and 5');
        }

        // Check if service exists and is active
        const service = await Service.findOne({ 
            _id: serviceId, 
            isDeleted: false,
            isActive: true 
        });

        if (!service) {
            throw new ApiError(404, 'Service not found or is not available');
        }

        // Check if user already reviewed this service
        const existingReview = await Review.findOne({
            service: serviceId,
            userId: userId
        });

        if (existingReview) {
            throw new ApiError(409, 'You have already reviewed this service. Use update instead.');
        }

        // Create new review
        const review = await Review.create({
            service: serviceId,
            userId: userId,
            rating: finalRating,
            comment: comment || ''
        });

        // Add review reference to service
        await Service.findByIdAndUpdate(serviceId, {
            $push: { reviews: review._id }
        });

        // Update service average rating
        await service.updateAverageRating();

        // Get updated service
        const updatedService = await Service.findById(serviceId)
            .populate('categoryId', 'name icon');

        res.status(201).json(
            new ApiResponse(201, {
                review: review,
                service: {
                    _id: updatedService._id,
                    name: updatedService.name,
                    averageRating: updatedService.averageRating,
                    totalReviews: updatedService.reviews.length
                }
            }, 'Review created successfully')
        );
    } catch (error) {
        console.error('Error creating review:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else if (error.code === 11000) {
            res.status(409).json(new ApiResponse(409, null, 'You have already reviewed this service'));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

export const updateReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { rating, comment } = req.body;
        const userId = req.user._id;

        // Find review
        const review = await Review.findOne({
            _id: reviewId,
            userId: userId
        });

        if (!review) {
            throw new ApiError(404, 'Review not found or you are not authorized');
        }

        // Update fields
        if (rating !== undefined) {
            if (rating < 1 || rating > 5) {
                throw new ApiError(400, 'Rating must be between 1 and 5');
            }
            review.rating = rating;
        }
        
        if (comment !== undefined) {
            review.comment = comment;
        }

        await review.save();

        // Update service average rating
        const service = await Service.findById(review.service);
        if (service) {
            await service.updateAverageRating();
        }

        res.status(200).json(
            new ApiResponse(200, review, 'Review updated successfully')
        );
    } catch (error) {
        console.error('Error updating review:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

export const getServiceReviews = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Check if service exists
        const service = await Service.findById(serviceId);
        if (!service || service.isDeleted) {
            throw new ApiError(404, 'Service not found');
        }

        // Get reviews with pagination
        const [reviews, totalCount] = await Promise.all([
            Review.find({ service: serviceId })
                .populate('userId', 'name email profileImage')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Review.countDocuments({ service: serviceId })
        ]);

        // Calculate rating distribution
        const ratingDistribution = {
            1: 0, 2: 0, 3: 0, 4: 0, 5: 0
        };
        
        const allReviews = await Review.find({ service: serviceId });
        allReviews.forEach(review => {
            ratingDistribution[review.rating]++;
        });

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json(
            new ApiResponse(200, {
                service: {
                    _id: service._id,
                    name: service.name,
                    icon: service.icon,
                    averageRating: service.averageRating,
                    totalReviews: service.reviews.length
                },
                statistics: {
                    averageRating: service.averageRating,
                    totalReviews: totalCount,
                    ratingDistribution
                },
                reviews: reviews,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }, 'Service reviews retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting reviews:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

export const getReviewById = async (req, res) => {
    try {
        const { reviewId } = req.params;

        const review = await Review.findById(reviewId)
            .populate('userId', 'name email profileImage')
            .populate('service', 'name icon price');

        if (!review) {
            throw new ApiError(404, 'Review not found');
        }

        res.status(200).json(
            new ApiResponse(200, review, 'Review retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting review:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

