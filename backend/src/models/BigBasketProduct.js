import mongoose from "../database.js";

const bigBasketProductSchema = new mongoose.Schema({
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
    weight: String,
    brand: String,
    url: String,
    mrp: Number,
    eta: String,
    notified: {
        type: Boolean,
        default: true
    },
    trackedAt: Date
}, {
    collection: 'bigbasket_products',
    strict: true,
    timestamps: true
});

bigBasketProductSchema.index({ productName: 'text', brand: 'text', categoryName: 'text' });
bigBasketProductSchema.index({ inStock: 1 });


export const BigBasketProduct = mongoose.model('bigbasket_products', bigBasketProductSchema);