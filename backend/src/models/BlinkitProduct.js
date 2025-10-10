import mongoose from "../database.js";

const blinkitProductSchema = new mongoose.Schema(
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
        },
        categoryId: String,
        subcategoryName: {
            type: String,
        },
        subcategoryId: String,

        // Product details
        productName: {
            type: String,
            required: true,
        },
        description: String,
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

        updatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        collection: "blinkit_products",
        timestamps: true,
    }
);

blinkitProductSchema.index({ productName: 'text', brand: 'text', categoryName: 'text' });
blinkitProductSchema.index({ inStock: 1 });
blinkitProductSchema.index({ productId: 1 });
blinkitProductSchema.index({ categoryName: 1 });
blinkitProductSchema.index({ priceDroppedAt: 1 });
blinkitProductSchema.index({ discount: 1 });
blinkitProductSchema.index({ inStock: 1, price: 1 });
blinkitProductSchema.index({ categoryName: 1, inStock: 1 });


export const BlinkitProduct = mongoose.model("blinkit_products", blinkitProductSchema);
