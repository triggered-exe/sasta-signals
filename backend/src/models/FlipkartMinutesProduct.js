import mongoose from "../database.js";

const flipkartMinutesProductSchema = new mongoose.Schema({
    // Product identification
    productId: {
        type: String,
        required: true,
        unique: true
    },

    // Category information
    categoryName: {
        type: String
    },
    categoryId: String,
    subcategoryName: {
        type: String
    },
    subcategoryId: String,

    // Product details
    productName: {
        type: String,
        required: true
    },
    description: String,
    inStock: {
        type: Boolean,
        default: true
    },
    imageUrl: String,
    url: String,

    // Price information
    price: {
        type: Number,
        required: true
    },
    previousPrice: Number,
    priceDroppedAt: Date,
    mrp: {
        type: Number,
        required: true
    },
    discount: {
        type: Number,
        default: 0
    },

    // Additional details
    weight: String,
    brand: String,

    // Tracking
    notified: {
        type: Boolean,
        default: false
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'flipkart_minutes_products',
    timestamps: true
});

flipkartMinutesProductSchema.index({ productName: 'text', brand: 'text', categoryName: 'text', subcategoryName: 'text' });
flipkartMinutesProductSchema.index({ inStock: 1 });
flipkartMinutesProductSchema.index({ productId: 1 });
flipkartMinutesProductSchema.index({ categoryName: 1 });
flipkartMinutesProductSchema.index({ priceDroppedAt: 1 });
flipkartMinutesProductSchema.index({ discount: 1 });
flipkartMinutesProductSchema.index({ notified: 1 });
flipkartMinutesProductSchema.index({ inStock: 1, price: 1 });
flipkartMinutesProductSchema.index({ categoryName: 1, inStock: 1 });

export const FlipkartMinutesProduct = mongoose.model('FlipkartMinutesProduct', flipkartMinutesProductSchema);
