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

// Create SubCategory
export const createSubCategory = async (req, res) => {
  try {
    const { name, categoryId } = req.body;
    const userId = req.user._id;

    if (!name || !categoryId) {
      // Delete uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ success: false, message: 'Name and categoryId are required' });
    }

    // Check if category exists and belongs to user
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check if subcategory already exists for this user and category
    const existingSubCategory = await SubCategory.findOne({ 
      userId, 
      categoryId,
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });
    
    if (existingSubCategory) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ success: false, message: 'SubCategory already exists in this category' });
    }

    const subCategoryData = {
      userId,
      categoryId,
      name,
      icon: req.file ? `/uploads/subcategories/${req.file.filename}` : null
    };

    const subCategory = await SubCategory.create(subCategoryData);

    return res.status(201).json({
      success: true,
      message: 'SubCategory created successfully',
      data: subCategory
    });
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Create subcategory error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get All SubCategories (with category details)
export const getAllSubCategories = async (req, res) => {
  try {
    const userId = req.user._id;
    const { categoryId } = req.query;

    let query = { userId };
    if (categoryId) {
      query.categoryId = categoryId;
    }

    const subCategories = await SubCategory.find(query)
      .populate('categoryId', 'name icon')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: subCategories
    });
  } catch (error) {
    console.error('Get subcategories error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get Single SubCategory
export const getSubCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId })
      .populate('categoryId', 'name icon');

    if (!subCategory) {
      return res.status(404).json({ success: false, message: 'SubCategory not found' });
    }

    return res.status(200).json({
      success: true,
      data: subCategory
    });
  } catch (error) {
    console.error('Get subcategory error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update SubCategory
export const updateSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, categoryId } = req.body;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId });
    
    if (!subCategory) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ success: false, message: 'SubCategory not found' });
    }

    // If categoryId is being changed, verify new category exists
    if (categoryId && categoryId !== subCategory.categoryId.toString()) {
      const category = await Category.findOne({ _id: categoryId, userId });
      if (!category) {
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ success: false, message: 'New category not found' });
      }
      subCategory.categoryId = categoryId;
    }

    // Check if new name conflicts with existing subcategory
    if (name && name !== subCategory.name) {
      const existingSubCategory = await SubCategory.findOne({ 
        userId, 
        categoryId: subCategory.categoryId,
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: id }
      });
      if (existingSubCategory) {
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ success: false, message: 'SubCategory name already exists in this category' });
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

    return res.status(200).json({
      success: true,
      message: 'SubCategory updated successfully',
      data: subCategory
    });
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Update subcategory error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Delete SubCategory
export const deleteSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId });
    
    if (!subCategory) {
      return res.status(404).json({ success: false, message: 'SubCategory not found' });
    }

    // Delete subcategory image
    if (subCategory.icon) {
      const imagePath = path.join('public', subCategory.icon);
      deleteOldImage(imagePath);
    }

    await SubCategory.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: 'SubCategory deleted successfully'
    });
  } catch (error) {
    console.error('Delete subcategory error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get SubCategories by Category
export const getSubCategoriesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const userId = req.user._id;

    // Verify category exists
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const subCategories = await SubCategory.find({ userId, categoryId })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: subCategories
    });
  } catch (error) {
    console.error('Get subcategories by category error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};