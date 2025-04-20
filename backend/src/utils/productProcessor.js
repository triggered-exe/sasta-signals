import { sendEmailWithDroppedProducts, sendTelegramMessage } from "../services/NotificationService.js";

/**
 * Process and store products in the database
 * @param {Array} products - Array of products to process
 * @param {string} categoryName - Category name for the products
 * @param {Object} options - Additional options
 * @param {Object} options.model - Mongoose model to use for storing products
 * @param {string} options.source - Source name for notifications (e.g., "Blinkit", "BigBasket")
 * @param {Boolean} options.telegramNotification - Whether to send Telegram notifications
 * @param {Boolean} options.emailNotification - Whether to send email notifications
 * @returns {Promise<number>} - Number of products processed
 */
export const processProducts = async (products, categoryName, options = {}) => {
    const { model, source = "Unknown", telegramNotification = false, emailNotification = false } = options;

    if (!model) {
        throw new Error("Product model is required for processing products");
    }

    try {
        const bulkOps = [];
        const droppedProducts = [];
        const now = new Date();
        const logPrefix = `${source.toUpperCase()}:`;

        // Get existing products for price comparison
        const productIds = products.filter((p) => p.inStock).map((p) => p.productId);

        const existingProducts = await model
            .find({
                productId: { $in: productIds },
            })
            .lean();

        const existingProductsMap = new Map(existingProducts.map((p) => [p.productId, p]));

        // Process each product
        for (const product of products) {
            const existingProduct = existingProductsMap.get(product.productId);

            // Make sure subcategoryName is retained if provided in the product
            const subcategoryName = product.subcategoryName || "";

            const productData = {
                ...product,
                productId: product.productId,
                productName: product.productName,
                categoryName: categoryName,
                subcategoryName: subcategoryName,
                inStock: product.inStock,
                mrp: product.mrp,
                price: product.price,
                discount: product.discount,
                imageUrl: product.imageUrl,
                url: product.url,
                updatedAt: now,
            };

            if (existingProduct) {
                if (existingProduct.price === product.price && product.inStock === existingProduct.inStock) {
                    continue; // Skip if price hasn't changed
                }

                // Update price history if price has changed
                productData.previousPrice = existingProduct.price;
                const currentDiscount = productData.discount;
                const previousDiscount = existingProduct.discount || 0;

                if (existingProduct.price > product.price) {
                    productData.priceDroppedAt = now;
                } else {
                    // Retain previous priceDroppedAt if exists
                    if (existingProduct.priceDroppedAt) {
                        productData.priceDroppedAt = existingProduct.priceDroppedAt;
                    }
                }
            } else {
                // For new products, set initial priceDroppedAt
                productData.priceDroppedAt = now;
            }

            bulkOps.push({
                updateOne: {
                    filter: { productId: product.productId },
                    update: { $set: productData },
                    upsert: true,
                },
            });
        }

        // Send notifications for price drops
        if (droppedProducts.length > 0) {
            console.log(`${logPrefix} Found ${droppedProducts.length} dropped products from ${categoryName}`);
            try {
                if (telegramNotification) {
                    await sendTelegramMessage(droppedProducts, source);
                }
                if (emailNotification) {
                    await sendEmailWithDroppedProducts(droppedProducts, source);
                }
            } catch (error) {
                console.error(`${logPrefix} Error sending notification:`, error);
            }
        }

        // Perform bulk write operation
        if (bulkOps.length > 0) {
            await model.bulkWrite(bulkOps, { ordered: false });
            console.log(`${logPrefix} Updated ${bulkOps.length} products from ${categoryName}`);
        }

        return bulkOps.length;
    } catch (error) {
        console.error(`Error processing products for ${source}:`, error);
        throw error;
    }
};
