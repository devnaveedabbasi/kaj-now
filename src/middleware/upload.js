import multer from 'multer';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIMES = new Set([...IMAGE_MIMES, 'application/pdf']);
const uploader = ({ maxSize = 5 * 1024 * 1024, documents = true } = {}) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSize },
  fileFilter: (_req, file, cb) => (documents ? DOCUMENT_MIMES : IMAGE_MIMES).has(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPEG, PNG, WebP images and PDF documents are allowed')),
});

export const uploadCategoryImage = uploader({ documents: false });
export const uploadServiceIcon = uploader({ documents: false });
export const uploadServiceImage = uploader({ documents: false });
export const uploadServiceFiles = uploader({ documents: false });
export const uploadServiceRequestImages = uploader({ documents: false }).fields([{ name: 'serviceImage', maxCount: 1 }]);
export const uploadProviderImage = uploader();
export const uploadProviderDocuments = uploader().fields([
  { name: 'facePhoto', maxCount: 1 }, { name: 'idCardFront', maxCount: 1 }, { name: 'idCardBack', maxCount: 1 },
  { name: 'certificates', maxCount: 5 }, { name: 'addressProof', maxCount: 1 }, { name: 'rightToWork', maxCount: 1 },
  { name: 'dbsCertificate', maxCount: 1 }, { name: 'companyAddressProof', maxCount: 1 },
]);
export const uploadContractPdf = uploader({ maxSize: 10 * 1024 * 1024 }).single('contractPdf');
export const uploadSignedContractPdf = uploader({ maxSize: 10 * 1024 * 1024 }).single('signedContract');
export const uploadWithdrawalReceipt = uploader().single('receipt');
export const uploadBanner = uploader({ documents: false }).single('banner');
export const uploadProviderProfilePicture = uploader({ documents: false }).fields([{ name: 'profilePicture', maxCount: 1 }]);
export const uploadProfilePicture = uploader({ documents: false }).fields([{ name: 'profilePicture', maxCount: 1 }]);
