import mongoose from "../database.js";

const instamartProductSchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true },
  categoryName: String,
  categoryId: String,
  subcategoryName: String,
  subcategoryId: String,
  inStock: Boolean,
  imageUrl: String,
  productName: String,
  price: Number,
  previousPrice: Number,
  priceDroppedAt: Date,
  discount: Number,
  variations: Array,
  trackedAt: Date
}, { 
  collection: 'instamart_products',
  strict: true,
  timestamps: true
});

export const InstamartProduct = mongoose.model('instamart_products', instamartProductSchema);
