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

bigBasketProductSchema.index({ productName: 'text', brand: 'text', categoryName: 'text', subcategoryName: 'text' });
bigBasketProductSchema.index({ inStock: 1 });
bigBasketProductSchema.index({ productId: 1 });
bigBasketProductSchema.index({ categoryName: 1 });
bigBasketProductSchema.index({ priceDroppedAt: 1 });
bigBasketProductSchema.index({ discount: 1 });
bigBasketProductSchema.index({ price: 1 });
bigBasketProductSchema.index({ updatedAt: 1 });
bigBasketProductSchema.index({ inStock: 1, price: 1 });
bigBasketProductSchema.index({ categoryName: 1, inStock: 1 });


export const BigBasketProduct = mongoose.model('bigbasket_products', bigBasketProductSchema);