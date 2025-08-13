import mongoose from "../database.js";

const jiomartProductSchema = new mongoose.Schema(
  {
    // Product identification
    productId: {
      type: String,
      required: true,
      unique: true,
    },

    // Category information
    categoryName: {
      type: String,
      required: true,
    },
    subcategoryName: {
      type: String,
      required: true,
    },

    // Product details
    productName: {
      type: String,
      required: true,
    },
    inStock: {
      type: Boolean,
      default: true,
    },
    imageUrl: String,
    url: String,

    // Price information
    price: {
      type: Number,
      required: true,
    },
    previousPrice: Number,
    priceDroppedAt: Date,
    mrp: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      default: 0,
    },

    // Additional details
    weight: String,
    brand: String,
    variants: String,

    // Notification tracking
    notified: {
      type: Boolean,
      default: true,
    },
  },
  {
    collection: "jiomart_products",
    timestamps: true,
    indexes: [
      { productId: 1 },
      { categoryName: 1 },
      { priceDroppedAt: 1 },
      { discount: 1 },
      { price: 1 },
      { updatedAt: 1 },
      { inStock: 1 },
    ],
  }
);

export const JiomartProduct = mongoose.model(
  "jiomart_products",
  jiomartProductSchema
);
