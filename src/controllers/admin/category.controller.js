import  Category  from '../../models/admin/category.model.js';
import  SubCategory  from '../../models/admin/subCategory.model.js';
import fs from 'fs';
import path from 'path';

// Helper function to delete old image
const deleteOldImage = (imagePath) => {
  if (imagePath && fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }
};

// Create Category
export const createCategory = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user._id;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    // Check if category already exists for this user
    const existingCategory = await Category.findOne({ userId, name: { $regex: new RegExp(`^${name}$`, 'i') } });
    if (existingCategory) {
      // Delete uploaded image if category exists
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }

    const categoryData = {
      userId,
      name,
      icon: req.file ? `/uploads/categories/${req.file.filename}` : null
    };

    const category = await Category.create(categoryData);

    return res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Create category error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get All Categories (with optional subcategories count)
export const getAllCategories = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const categories = await Category.find({ userId }).sort({ createdAt: -1 });
    
    // Get subcategory count for each category
    const categoriesWithCount = await Promise.all(
      categories.map(async (category) => {
        const subCategoryCount = await SubCategory.countDocuments({ 
          userId, 
          categoryId: category._id 
        });
        return {
          ...category.toObject(),
          subCategoryCount
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: categoriesWithCount
    });
  } catch (error) {
    console.error('Get categories error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get Single Category
export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Get subcategories for this category
    const subCategories = await SubCategory.find({ userId, categoryId: id });

    return res.status(200).json({
      success: true,
      data: {
        category,
        subCategories
      }
    });
  } catch (error) {
    console.error('Get category error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update Category
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });
    
    if (!category) {
      // Delete uploaded image if category not found
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check if new name conflicts with existing category
    if (name && name !== category.name) {
      const existingCategory = await Category.findOne({ 
        userId, 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: id }
      });
      if (existingCategory) {
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ success: false, message: 'Category name already exists' });
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

    return res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Update category error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Delete Category
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check if category has subcategories
    const subCategoriesCount = await SubCategory.countDocuments({ userId, categoryId: id });
    if (subCategoriesCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete category. It has ${subCategoriesCount} subcategory(s). Delete subcategories first.` 
      });
    }

    // Delete category image
    if (category.icon) {
      const imagePath = path.join('public', category.icon);
      deleteOldImage(imagePath);
    }

    await Category.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};