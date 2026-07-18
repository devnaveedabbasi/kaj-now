import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema(
  {
    // title: {
    //   type: String,
    //   required: true,
    //   trim: true,
    //   maxlength: 150,
    // },
    // description: {
    //   type: String,
    //   trim: true,
    //   default: "",
    //   maxlength: 500,
    // },
    image: {
      type: String,
      required: true,
    },
    region: {
      type: String,
      enum: ['UK', 'BD'],
      default: 'BD'
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false, // soft delete
    },
  },
  { timestamps: true }
);

export default mongoose.model("Banner", bannerSchema);