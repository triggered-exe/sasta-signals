import mongoose from "mongoose";

const zeptoProductSchema = new mongoose.Schema(
    {
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
        notified: {
            type: Boolean,
            default: true,
        },
        previousPrice: {
            type: Number,
            default: null,
        },
        priceDroppedAt: {
            type: Date,
            default: null,
        },
    },
    {
        collection: "zepto_products",
        strict: true,
        timestamps: true,
    }
);

// Indexes for commonly queried fields
zeptoProductSchema.index({ price: 1 });
zeptoProductSchema.index({ priceDroppedAt: 1 });
zeptoProductSchema.index({ updatedAt: 1 });
zeptoProductSchema.index({ inStock: 1 });

export const ZeptoProduct = mongoose.model("zepto_products", zeptoProductSchema);
