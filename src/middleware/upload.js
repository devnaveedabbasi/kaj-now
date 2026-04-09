import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure upload directories exist
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Configure storage for categories
const categoryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/categories';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `category-${uniqueSuffix}${ext}`);
  }
});

// Configure storage for subcategories
const subCategoryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/subcategories';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `subcategory-${uniqueSuffix}${ext}`);
  }
});

const providerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/provider';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fieldName = file.fieldname;
    const ext = path.extname(file.originalname);
    cb(null, `${fieldName}-${uniqueSuffix}${ext}`);
  }
});




// File filter for images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'));
  }
};

// Create multer instances
export const uploadCategoryImage = multer({
  storage: categoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

export const uploadSubCategoryImage = multer({
  storage: subCategoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

export const uploadProviderImage = multer({
  storage: providerStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});



// Create multer instance for provider documents
export const uploadProviderDocuments = multer({
  storage: providerStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
}).fields([
  { name: 'facePhoto', maxCount: 1 },
  { name: 'idCardFront', maxCount: 1 },
  { name: 'idCardBack', maxCount: 1 },
  { name: 'certificates', maxCount: 10 }
]);