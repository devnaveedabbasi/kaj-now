import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure upload directories exist
const ensureDirectoryExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images (jpeg, jpg, png, webp) and PDF files are allowed'));
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

// Configure storage for SERVICE ICONS only
const serviceIconStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/services/icons';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `icon-${uniqueSuffix}${ext}`);
  }
});

// Configure storage for SERVICE IMAGES only
const serviceImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/services/images';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `image-${uniqueSuffix}${ext}`);
  }
});

// Storage for provider-submitted service-request images (UK template flow —
// provider supplies their own listing photos when applying for a service)
const serviceRequestStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/service-requests';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `request-${uniqueSuffix}${ext}`);
  }
});

export const uploadServiceRequestImages = multer({
  storage: serviceRequestStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
}).fields([
  // Provider's own cover photo for the listing — used for both the
  // template path and the custom-service path (which has no separate
  // admin-provided icon to fall back on).
  { name: 'serviceImage', maxCount: 1 },
]);

// Provider storage
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


const userStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/users';
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

// Create multer instances
export const uploadCategoryImage = multer({
  storage: categoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

// For service ICON only
export const uploadServiceIcon = multer({
  storage: serviceIconStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

// For service IMAGE only
export const uploadServiceImage = multer({
  storage: serviceImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

// For both icon and image together
export const uploadServiceFiles = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'icon') {
        const dir = 'public/uploads/services/icons';
        ensureDirectoryExists(dir);
        cb(null, dir);
      } else {
        const dir = 'public/uploads/services';
        ensureDirectoryExists(dir);
        cb(null, dir);
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const prefix = file.fieldname === 'icon' ? 'icon' : 'image';
      cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

export const uploadProviderImage = multer({
  storage: providerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});


// Create multer instance for provider documents
export const uploadProviderDocuments = multer({
  storage: providerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
}).fields([
  // BD + UK Individual — common
  { name: 'facePhoto',    maxCount: 1 },
  { name: 'idCardFront',  maxCount: 1 },
  { name: 'idCardBack',   maxCount: 1 },
  { name: 'certificates', maxCount: 5 },
  // UK Individual — extra
  { name: 'addressProof',    maxCount: 1 },
  { name: 'rightToWork',     maxCount: 1 },
  { name: 'dbsCertificate',  maxCount: 1 },
  // UK Company
  { name: 'companyAddressProof', maxCount: 1 },
]);



// Contract PDF — admin uploads, always overwrites same filename
const contractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/contracts';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'kajnow_provider_agreement.pdf');
  }
});

export const uploadContractPdf = multer({
  storage: contractStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
}).single('contractPdf');

// Signed contract PDF — provider uploads their signed copy of the agreement
const signedContractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/contracts/signed';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `signed-${req.user._id}-${Date.now()}.pdf`);
  }
});

export const uploadSignedContractPdf = multer({
  storage: signedContractStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
}).single('signedContract');

const withdrawalReceiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/withdrawals/receipts';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const withdrawalId = req.params.withdrawalId || 'unknown';
    cb(null, `receipt-${withdrawalId}-${uniqueSuffix}${ext}`);
  }
});


const uploadBannerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'public/uploads/banners';
    ensureDirectoryExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
   const filename = file.originalname;
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const bannerId = req.params.id || 'new';
    cb(null, `ba-${bannerId}-${uniqueSuffix}${ext}`);
  }
});



export const uploadBanner = multer({
  storage: uploadBannerStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter
}).single('banner'); 


export const uploadWithdrawalReceipt = multer({
  storage: withdrawalReceiptStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter
}).single('receipt'); 




// Add this to your upload.js
export const uploadProviderProfilePicture = multer({
  storage: providerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
}).fields([
  { name: 'profilePicture', maxCount: 1 }
]);
export const uploadProfilePicture = multer({
  storage: userStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
}).fields([
  { name: 'profilePicture', maxCount: 1 }
]);

