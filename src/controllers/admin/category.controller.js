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

// Create Category
export const createCategory = async (req, res) => {
  const { name } = req.body;
  const userId = req.user._id;

  if (!name) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(400, 'Category name is required');
  }

  // Check if category already exists for this user
  const existingCategory = await Category.findOne({
    userId,
    name: { $regex: new RegExp(`^${name}$`, 'i') },
  });
  if (existingCategory) {
    // Delete uploaded image if category exists
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(409, 'Category already exists');
  }

  const categoryData = {
    userId,
    name,
    icon: req.file ? `/uploads/categories/${req.file.filename}` : null,
  };

  const category = await Category.create(categoryData);

  res.status(201).json(
    new ApiResponse(201, category, 'Category created successfully')
  );
};

// Get All Categories (with optional subcategories count)
export const getAllCategories = async (req, res) => {
  const userId = req.user._id;

  const categories = await Category.find({ userId }).sort({ createdAt: -1 });

  // Get subcategory count for each category
  const categoriesWithCount = await Promise.all(
    categories.map(async (category) => {
      const subCategoryCount = await SubCategory.countDocuments({
        userId,
        categoryId: category._id,
      });
      return {
        ...category.toObject(),
        subCategoryCount,
      };
    })
  );

  res.status(200).json(
    new ApiResponse(
      200,
      categoriesWithCount,
      'Categories retrieved successfully'
    )
  );
};

// Get Single Category
export const getCategoryById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const category = await Category.findOne({ _id: id, userId });

  if (!category) {
    throw new ApiError(404, 'Category not found');
  }

  // Get subcategories for this category
  const subCategories = await SubCategory.find({ userId, categoryId: id });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        category,
        subCategories,
      },
      'Category retrieved successfully'
    )
  );
};

// Update Category
export const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const userId = req.user._id;

  const category = await Category.findOne({ _id: id, userId });

  if (!category) {
    // Delete uploaded image if category not found
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    throw new ApiError(404, 'Category not found');
  }

  // Check if new name conflicts with existing category
  if (name && name !== category.name) {
    const existingCategory = await Category.findOne({
      userId,
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: id },
    });
    if (existingCategory) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      throw new ApiError(409, 'Category name already exists');
    }
  }

  // Update fields
  if (name) category.name = name;

  // Update image if new file uploaded
  if (req.file) {
    // Delete old image if exists
    if (category.icon) {
      const oldImagePath = path.join('public', category.icon);
      deleteOldImage(oldImagePath);
    }
    category.icon = `/uploads/categories/${req.file.filename}`;
  }

  await category.save();

  res.status(200).json(
    new ApiResponse(200, category, 'Category updated successfully')
  );
};

// Delete Category
export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const category = await Category.findOne({ _id: id, userId });

  if (!category) {
    throw new ApiError(404, 'Category not found');
  }

  // Check if category has subcategories
  const subCategoriesCount = await SubCategory.countDocuments({
    userId,
    categoryId: id,
  });
  if (subCategoriesCount > 0) {
    throw new ApiError(
      400,
      `Cannot delete category. It has ${subCategoriesCount} subcategory(s). Delete subcategories first.`
    );
  }

  // Delete category image
  if (category.icon) {
    const imagePath = path.join('public', category.icon);
    deleteOldImage(imagePath);
  }

  await Category.deleteOne({ _id: id });

  res.status(200).json(
    new ApiResponse(200, {}, 'Category deleted successfully')
  );
};