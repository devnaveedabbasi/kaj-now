import Category from '../../models/admin/category.model.js';
import SubCategory from '../../models/admin/subCategory.model.js';
import fs from 'fs';
import path from 'path';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

// Helper function to delete old image
const deleteOldImage = (imagePath) => {
  try {
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  } catch (error) {
    console.error('Error deleting old image:', error);
  }
};

// Create SubCategory
export const createSubCategory = async (req, res) => {
  const { name, categoryId } = req.body;
  const userId = req.user._id;

  if (!name || !categoryId) {
    // Delete uploaded file if validation fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(400, 'Name and categoryId are required');
  }

  // Check if category exists and belongs to user
  const category = await Category.findOne({ _id: categoryId, userId });
  if (!category) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(404, 'Category not found');
  }

  // Check if subcategory already exists for this user and category
  const existingSubCategory = await SubCategory.findOne({
    userId,
    categoryId,
    name: { $regex: new RegExp(`^${name}$`, 'i') },
  });

  if (existingSubCategory) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(409, 'SubCategory already exists in this category');
  }

  const subCategoryData = {
    userId,
    categoryId,
    name,
    icon: req.file ? `/uploads/subcategories/${req.file.filename}` : null,
  };

  const subCategory = await SubCategory.create(subCategoryData);

  res.status(201).json(
    new ApiResponse(201, subCategory, 'SubCategory created successfully')
  );
};

// Get All SubCategories (with category details)
export const getAllSubCategories = async (req, res) => {
  const userId = req.user._id;
  const { categoryId } = req.query;

  let query = { userId };
  if (categoryId) {
    query.categoryId = categoryId;
  }

  const subCategories = await SubCategory.find(query)
    .populate('categoryId', 'name icon')
    .sort({ createdAt: -1 });

  res.status(200).json(
    new ApiResponse(
      200,
      subCategories,
      'SubCategories retrieved successfully'
    )
  );
};

// Get Single SubCategory
export const getSubCategoryById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const subCategory = await SubCategory.findOne({ _id: id, userId }).populate(
    'categoryId',
    'name icon'
  );

  if (!subCategory) {
    throw new ApiError(404, 'SubCategory not found');
  }

  res.status(200).json(
    new ApiResponse(
      200,
      subCategory,
      'SubCategory retrieved successfully'
    )
  );
};

// Update SubCategory
export const updateSubCategory = async (req, res) => {
  const { id } = req.params;
  const { name, categoryId } = req.body;
  const userId = req.user._id;

  const subCategory = await SubCategory.findOne({ _id: id, userId });

  if (!subCategory) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(404, 'SubCategory not found');
  }

  // If categoryId is being changed, verify new category exists
  if (categoryId && categoryId !== subCategory.categoryId.toString()) {
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      throw new ApiError(404, 'New category not found');
    }
    subCategory.categoryId = categoryId;
  }

  // Check if new name conflicts with existing subcategory
  if (name && name !== subCategory.name) {
    const existingSubCategory = await SubCategory.findOne({
      userId,
      categoryId: subCategory.categoryId,
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: id },
    });
    if (existingSubCategory) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      throw new ApiError(409, 'SubCategory name already exists in this category');
    }
    subCategory.name = name;
  }

  // Update image if new file uploaded
  if (req.file) {
    // Delete old image if exists
    if (subCategory.icon) {
      const oldImagePath = path.join('public', subCategory.icon);
      deleteOldImage(oldImagePath);
    }
    subCategory.icon = `/uploads/subcategories/${req.file.filename}`;
  }

  await subCategory.save();

  res.status(200).json(
    new ApiResponse(200, subCategory, 'SubCategory updated successfully')
  );
};

// Delete SubCategory
export const deleteSubCategory = async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const subCategory = await SubCategory.findOne({ _id: id, userId });

  if (!subCategory) {
    throw new ApiError(404, 'SubCategory not found');
  }

  // Delete subcategory image
  if (subCategory.icon) {
    const imagePath = path.join('public', subCategory.icon);
    deleteOldImage(imagePath);
  }

  await SubCategory.deleteOne({ _id: id });

  res.status(200).json(
    new ApiResponse(200, {}, 'SubCategory deleted successfully')
  );
};

// Get SubCategories by Category
export const getSubCategoriesByCategory = async (req, res) => {
  const { categoryId } = req.params;
  const userId = req.user._id;

  // Verify category exists
  const category = await Category.findOne({ _id: categoryId, userId });
  if (!category) {
    throw new ApiError(404, 'Category not found');
  }

  const subCategories = await SubCategory.find({ userId, categoryId }).sort({
    createdAt: -1,
  });

  res.status(200).json(
    new ApiResponse(
      200,
      subCategories,
      'SubCategories retrieved successfully'
    )
  );
};