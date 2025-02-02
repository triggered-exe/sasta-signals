import mongoose from "../database.js";

const flipkartGroceryProductSchema = new mongoose.Schema({
    // Product identification
    productId: { type: String, required: true, unique: true },
    
    // Category information
    categoryName: String,
    categoryId: String,
    subcategoryName: String,
    subcategoryId: String,
    
    // Product details
    productName: String,
    description: String,
    inStock: Boolean,
    imageUrl: String,
    url: String,
    
    // Price information
    price: Number,
    previousPrice: Number,
    priceDroppedAt: Date,
    mrp: Number,
    discount: Number,
    
    // Additional details
    weight: String,
    brand: String,
    
    // Tracking
    updatedAt: Date
}, { 
    collection: 'flipkart_grocery_products',
    timestamps: true,
    indexes: [
        { productId: 1 },
        { priceDroppedAt: 1 },
        { updatedAt: 1 }
    ]
});

export const FlipkartGroceryProduct = mongoose.model('flipkart_grocery_products', flipkartGroceryProductSchema); 