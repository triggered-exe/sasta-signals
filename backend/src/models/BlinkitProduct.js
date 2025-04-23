import mongoose from "mongoose";

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
        indexes: [{ productId: 1 }, { categoryName: 1 }, { priceDroppedAt: 1 }, { discount: 1 }],
    }
);

export const BlinkitProduct = mongoose.model("blinkit_products", blinkitProductSchema);
