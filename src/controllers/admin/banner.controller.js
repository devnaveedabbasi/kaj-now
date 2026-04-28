import Banner from "../../models/admin/banner.model.js";
import { ApiError } from "../../utils/errorHandler.js";
import { ApiResponse } from "../../utils/apiResponse.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const MAX_BANNERS = 5;

export const createBanner = asyncHandler(async (req, res) => {
  const { title, description } = req.body;

  if (!title?.trim()) {
    throw new ApiError(400, "Banner title is required");
  }

  if (!req.file) {
    throw new ApiError(400, "Banner image is required");
  }

  const count = await Banner.countDocuments({ isDeleted: false });

  if (count >= MAX_BANNERS) {
    throw new ApiError(
      400,
      `Maximum ${MAX_BANNERS} banners allowed`
    );
  }

  const banner = await Banner.create({
    title: title.trim(),
    description: description?.trim() || "",
    image: `/uploads/banners/${req.file.filename}`,
    isActive: true,
    isDeleted: false,
  });

  return res.status(201).json(
    new ApiResponse(201, banner, "Banner created successfully")
  );
});


export const getBanners = asyncHandler(async (req, res) => {
  const banners = await Banner.find({ isDeleted: false }).sort({
    createdAt: -1,
  });

  const summary = {
    total: banners.length,
    active: banners.filter((b) => b.isActive).length,
    inactive: banners.filter((b) => !b.isActive).length,
  };

  // Response mein banners aur summary dono bhejo
  return res.status(200).json(
    new ApiResponse(
      200,
      { 
        banners: banners,  // Sab banners (active + inactive)
        summary 
      },
      "Banners fetched successfully"
    )
  );
});

export const getActiveBanners = asyncHandler(async (req, res) => {
  const banners = await Banner.find({
    isActive: true,
    isDeleted: false,
  }).sort({ createdAt: -1 });

  return res.status(200).json(
    new ApiResponse(200, banners, "Active banners fetched")
  );
});

export const updateBanner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;

  const banner = await Banner.findById(id);

  if (!banner || banner.isDeleted) {
    throw new ApiError(404, "Banner not found");
  }

  if (title) banner.title = title.trim();
  if (description !== undefined) {
    banner.description = description.trim();
  }

  // IMAGE UPDATE
  if (req.file) {
    banner.image = `/uploads/banners/${req.file.filename}`;
  }

  await banner.save();

  return res.status(200).json(
    new ApiResponse(200, banner, "Banner updated successfully")
  );
});


export const deleteBanner = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const banner = await Banner.findById(id);

  if (!banner) {
    throw new ApiError(404, "Banner not found");
  }

  banner.isDeleted = true;
  banner.isActive = false;

  await banner.save();

  return res.status(200).json(
    new ApiResponse(200, null, "Banner deleted successfully")
  );
});


export const toggleBannerStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const banner = await Banner.findById(id);

  if (!banner || banner.isDeleted) {
    throw new ApiError(404, "Banner not found");
  }

  banner.isActive = !banner.isActive;

  await banner.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      banner,
      `Banner ${banner.isActive ? "activated" : "deactivated"}`
    )
  );
});