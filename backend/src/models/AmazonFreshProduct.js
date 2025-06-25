import mongoose from "../database.js";

const amazonFreshProductSchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        unique: true,
    },
    productName: {
        type: String,
        required: true,
    },
    price: {
        type: Number,
        required: true,
    },
    mrp: {
        type: Number,
        required: true,
    },
    discount: {
        type: Number,
        default: 0,
    },
    imageUrl: String,
    url: String,
    weight: String,
    unit: String,
    pricePerUnit: Number,
    brand: String,
    inStock: {
        type: Boolean,
        default: true,
    },
    lastInStock: Date,
    lastChecked: Date,
    priceDroppedAt: Date,
    previousPrice: Number,
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    categoryName: String,
    subcategoryName: String,
});

export const AmazonFreshProduct = mongoose.model("amazon_fresh_products", amazonFreshProductSchema); 