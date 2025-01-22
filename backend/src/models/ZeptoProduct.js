import mongoose from 'mongoose';

const zeptoProductSchema = new mongoose.Schema({
    productId: { type: String, required: true, unique: true },
    productName: { type: String, required: true },
    categoryName: { type: String, required: true },
    subcategoryName: { type: String, required: true },
    inStock: { type: Boolean, default: true },
    imageUrl: { type: String },
    price: { type: Number, required: true },
    mrp: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    weight: { type: String },
    brand: { type: String },
    url: { type: String },
    eta: { type: String },
    previousPrice: { type: Number },
    priceDroppedAt: { type: Date },
    createdAt: { type: Date },
    updatedAt: { type: Date },

    // Additional fields from Zepto API
    description: { type: String, default: '' },
    ingredients: { type: String, default: '' },
    countryOfOrigin: { type: String, default: '' },
    manufacturerName: { type: String, default: '' },
    manufacturerAddress: { type: String, default: '' },
    howToUse: { type: String, default: '' },
    searchKeywords: [{ type: String }],
    imported: { type: Boolean, default: false },
    minimumRequiredAge: { type: Number, default: 0 },
    discountApplicable: { type: Boolean, default: false },
    rating: { type: Number, default: 0 },
    totalRatings: { type: Number, default: 0 },
    maxAllowedQuantity: { type: Number, default: 0 },
    shelfLife: { type: String, default: '' },
    storageInstructions: { type: String, default: '' },
    packagingType: { type: String, default: '' },
    fssaiLicense: { type: String, default: '' },
    nutritionalInfo: { type: String, default: '' }
});

// Indexes for commonly queried fields
zeptoProductSchema.index({ productId: 1 });
zeptoProductSchema.index({ price: 1 });
zeptoProductSchema.index({ priceDroppedAt: 1 });
zeptoProductSchema.index({ updatedAt: 1 });
zeptoProductSchema.index({ inStock: 1 });

export const ZeptoProduct = mongoose.model('zepto_products', zeptoProductSchema); 