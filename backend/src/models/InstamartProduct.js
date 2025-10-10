import mongoose from "../database.js";

const instamartProductSchema = new mongoose.Schema({
  // Product identification
  productId: { type: String, required: true },
  variationId: { type: String, required: true, unique: true },

  // Category information
  categoryName: String,
  categoryId: String,
  subcategoryName: String,
  subcategoryId: String,

  // Product details
  productName: String,
  displayName: String,
  description: String,
  url: String,
  inStock: Boolean,
  imageUrl: String,

  // Price information
  price: Number,
  previousPrice: Number,
  priceDroppedAt: Date,
  priceDropNotificationSent: { type: Boolean, default: true },
  mrp: Number,
  storePrice: Number,
  discount: Number,

  // Variation specific details
  quantity: String,
  unit: String,
  weight: String,

  // Tracking
  trackedAt: Date
}, {
  collection: 'instamart_products',
  strict: true,
  timestamps: true
});

instamartProductSchema.index({ productName: 'text', categoryName: 'text' });
instamartProductSchema.index({ inStock: 1 });
instamartProductSchema.index({ productId: 1 });
instamartProductSchema.index({ priceDroppedAt: 1 });
instamartProductSchema.index({ updatedAt: 1 });


export const InstamartProduct = mongoose.model('instamart_products', instamartProductSchema);
