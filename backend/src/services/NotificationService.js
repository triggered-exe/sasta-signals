import axios from 'axios';
import { Resend } from 'resend';
import { chunk } from '../utils/priceTracking.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends Telegram notifications for products with significant price drops
 * @param {Array} droppedProducts - Array of products with price drops
 * @param {String} source - Source of products (Instamart, Zepto, etc.)
 * @param {Number} minDiscountThreshold - Minimum discount percentage to send notification for
 * @returns {Promise<void>}
 */
export const sendTelegramMessage = async (droppedProducts, source, minDiscountThreshold = 50) => {
    try {
        if (!droppedProducts || droppedProducts.length === 0) {
            console.log(`${source}: No dropped products to send Telegram message for`);
            return;
        }

        // Filter products with discount > threshold and sort by highest discount
        const filteredProducts = droppedProducts
            .filter((product) => product.discount > minDiscountThreshold)
            .sort((a, b) => b.discount - a.discount);

        if (filteredProducts.length === 0) {
            return;
        }

        // Remove duplicates based on productId
        const uniqueFilteredProducts = filteredProducts.filter((product, index, self) =>
            index === self.findIndex(p => p.productId === product.productId)
        );

        if (uniqueFilteredProducts.length !== filteredProducts.length) {
            console.log(`${source}: Removed ${filteredProducts.length - uniqueFilteredProducts.length} duplicate products from Telegram notification`);
        }

        // Chunk products into groups of 10-15 for readability
        const productChunks = chunk(uniqueFilteredProducts, 10);
        console.log(`${source}: Sending Telegram messages for ${uniqueFilteredProducts.length} products`);

        for (let i = 0; i < productChunks.length; i++) {
            const products = productChunks[i];
            const messageText = `🔥 <b>${source} Price Drops</b>\n\n` +
                products.map((product) => {
                    const priceDrop = product.previousPrice - product.price;
                    return (
                        `<b>${product.productName}</b>\n` +
                        `💰 Current: ₹${product.price}\n` +
                        `📊 Previous: ₹${product.previousPrice}\n` +
                        `📉 Drop: ₹${priceDrop.toFixed(2)} (${product.discount}% off)\n` +
                        `🔗 <a href="${product.url}">View on ${source}</a>\n`
                    );
                }).join("\n");

            await axios.post(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    chat_id: TELEGRAM_CHANNEL_ID,
                    text: messageText,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                }
            );

            // Add delay between chunks
            if (i < productChunks.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        console.log(`${source}: Sent notifications for ${uniqueFilteredProducts.length} products`);
    } catch (error) {
        console.error(`${source}: Error sending Telegram message:`, error?.response?.data || error);
        throw error;
    }
};

/**
 * Sends email notifications for products with price drops
 * @param {Array} droppedProducts - Array of products with price drops
 * @param {String} source - Source of products (Instamart, Zepto, etc.)
 * @returns {Promise<void>}
 */
export const sendEmailWithDroppedProducts = async (droppedProducts, source) => {
    try {
        // Skip sending email if no dropped products
        if (!droppedProducts || droppedProducts.length === 0) {
            console.log(`${source}: No dropped products to send email for`);
            return;
        }

        // Remove duplicates based on productId
        const uniqueDroppedProducts = droppedProducts.filter((product, index, self) =>
            index === self.findIndex(p => p.productId === product.productId)
        );

        if (uniqueDroppedProducts.length !== droppedProducts.length) {
            console.log(`${source}: Removed ${droppedProducts.length - uniqueDroppedProducts.length} duplicate products from email notification`);
        }

        // Chunk products into groups of 10 for better email rendering
        const productChunks = chunk(uniqueDroppedProducts, 10);
        console.log(`${source}: Sending email for ${uniqueDroppedProducts.length} products in ${productChunks.length} chunks`);

        for (let i = 0; i < productChunks.length; i++) {
            const products = productChunks[i];
            const emailContent = `
                <h2>Recently Dropped Products on ${source} (Part ${i + 1}/${productChunks.length})</h2>
                <div style="font-family: Arial, sans-serif;">
                    ${products
                    .map(
                        (product) => `
                        <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #eee; border-radius: 8px;">
                            <a href="${product.url}"  
                               style="text-decoration: none; color: inherit; display: block;">
                                <div style="display: flex; align-items: center;">
                                    <img src="${product.imageUrl}" 
                                       alt="${product.productName}" 
                                       style="width: 100px; height: 100px; object-fit: cover; border-radius: 4px; margin-right: 15px;">
                                    <div>
                                        <h3 style="margin: 0 0 8px 0;">${product.productName}</h3>
                                        <p style="margin: 4px 0; color: #2f80ed;">
                                            Current Price: ₹${product.price}
                                            <span style="text-decoration: line-through; color: #666; margin-left: 8px;">
                                                ₹${product.previousPrice}
                                            </span>
                                        </p>
                                        <p style="margin: 4px 0; color: #219653;">
                                            Price Drop: ₹${(product.previousPrice - product.price).toFixed(2)} (${product.discount}% off)
                                        </p>
                                    </div>
                                </div>
                            </a>
                        </div>
                        `
                    )
                    .join("")}
                </div>
            `;

            await resend.emails.send({
                from: "onboarding@resend.dev",
                to: "harishanker.500apps@gmail.com",
                subject: `🔥 Price Drops Alert - ${source} Products (Part ${i + 1}/${productChunks.length})`,
                html: emailContent,
            });
            
            // Add a small delay between emails
            if (i < productChunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`${source}: Email notifications sent successfully for ${uniqueDroppedProducts.length} unique products`);
    } catch (error) {
        console.error(`${source}: Error sending email:`, error);
        throw error;
    }
};

/**
 * Combines both notification methods
 * @param {Array} droppedProducts - Array of products with price drops
 * @param {String} source - Source of products
 * @returns {Promise<void>}
 */
export const sendPriceDropNotifications = async (droppedProducts, source) => {
    try {
        if (!droppedProducts || droppedProducts.length === 0) return;
        
        // Send both notifications concurrently
        await Promise.all([
            sendEmailWithDroppedProducts(droppedProducts, source),
            sendTelegramMessage(droppedProducts, source)
        ]);
    } catch (error) {
        console.error(`${source}: Error in sendPriceDropNotifications:`, error);
    }
}; 