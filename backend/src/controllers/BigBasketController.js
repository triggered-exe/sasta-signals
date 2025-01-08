import { AppError } from '../utils/errorHandling.js';
import { createPage, cleanup, hasStoredLocation, getContextStats, storeContext } from '../utils/crawlerSetup.js';
import axios from 'axios';

export const searchProducts = async (req, res, next) => {
    let page = null;
    let context = null;
    
    try {
        const { query, pincode } = req.body;

        if (!query || !pincode) {
            throw AppError.badRequest("Query and pincode are required");
        }

        const isNewLocation = !hasStoredLocation(pincode);
        
        // Create new page with pincode
        page = await createPage(pincode, isNewLocation);
        context = page.context();

        // Check if we need to set location
        if (isNewLocation) {
            // Navigate to BigBasket
            await page.goto('https://www.bigbasket.com/', { waitUntil: 'networkidle' });

            // Set location
            console.log('Setting location...');
            
            // Click the location selector
            const clickResult = await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('span')).filter(span => 
                    span.textContent.trim() === 'Select Location'
                );
                if (spans.length > 0) {
                    spans[0].click();
                    return { clicked: true, count: spans.length };
                }
                return { clicked: false, count: spans.length };
            });
            console.log('Click result:', clickResult);

            await page.waitForTimeout(500);

            // Find and fill the input field
            const inputs = await page.$$('input[placeholder="Search for area or street name"]');
            if (inputs.length >= 2) {
                await inputs[1].type(pincode);
                console.log('Entered pincode:', pincode);
            } else {
                throw new Error('Input field for location not found');
            }

            // Handle location dropdown
            try {
                await page.waitForSelector('.overscroll-contain', { timeout: 2000 });
                
                const locationResult = await page.evaluate(() => {
                    const firstLocation = document.querySelector('.overscroll-contain li');
                    if (firstLocation) {
                        firstLocation.click();
                        return { clicked: true };
                    }
                    return { clicked: false };
                });
                console.log('Location selection result:', locationResult);

                if (!locationResult.clicked) {
                    throw new Error('No locations found in dropdown');
                }

                await page.waitForTimeout(1000);

            } catch (error) {
                throw AppError.badRequest(`Delivery not available for pincode: ${pincode}`);
            }

            // Store the context after location is set successfully
            await storeContext(pincode, context);
        }

        // Navigate directly to search results
        await page.goto(`https://www.bigbasket.com/ps/?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle' });

        // Wait for products
        await page.waitForSelector('.PaginateItems___StyledLi-sc-1yrbjdr-0', { timeout: 10000 });

        // Scroll to load all products
        let hasMore = true;
        while (hasMore) {
            hasMore = await page.evaluate(async () => {
                const knownItem = document.querySelector('.PaginateItems___StyledLi-sc-1yrbjdr-0');
                if (!knownItem) return false;

                const parentContainer = knownItem.closest('ul');
                if (!parentContainer) return false;

                const items = parentContainer.children;
                if (items.length === 0) return false;

                let lastItem = items[items.length - 1];
                const previousCount = items.length;
                
                lastItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 1000)); // wait for 1 second before checking again
                
                const newCount = parentContainer.children.length;
                if (newCount >= 100) {
                    parentContainer.children[parentContainer.children.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    console.log('found 50 products');
                    return false;
                }
                return newCount > previousCount;
            });
        }

        // Extract products
        const products = await page.evaluate(async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const knownItem = document.querySelector('.PaginateItems___StyledLi-sc-1yrbjdr-0');
            const parentContainer = knownItem?.closest('ul');
            if (!parentContainer) return [];

            return Array.from(parentContainer.children).map(item => {
                const discountElement = item.querySelector('.Tags___StyledLabel2-sc-aeruf4-1 .font-semibold');
                const priceElement = item.querySelector('.Pricing___StyledLabel-sc-pldi2d-1');
                const mrpElement = item.querySelector('.Pricing___StyledLabel2-sc-pldi2d-2');
                const brandElement = item.querySelector('.BrandName___StyledLabel2-sc-hssfrl-1');
                const nameElement = item.querySelector('.text-darkOnyx-800');
                const imageElement = item.querySelector('img');
                const weightElement = item.querySelector('.PackChanger___StyledLabel-sc-newjpv-1');
                const ratingElement = item.querySelector('.Badges___StyledLabel-sc-1k3p1ug-0');
                const ratingCountElement = item.querySelector('.ReviewsAndRatings___StyledLabel-sc-2rprpc-1');

                const price = priceElement ? parseFloat(priceElement.textContent.replace(/[^\d.]/g, '')) : null;
                const mrp = mrpElement ? parseFloat(mrpElement.textContent.replace(/[^\d.]/g, '')) : price;
                const discount = discountElement ? parseInt(discountElement.textContent) : 0;
                
                return {
                    name: nameElement ? nameElement.textContent.trim() : '',
                    brand: brandElement ? brandElement.textContent.trim() : '',
                    weight: weightElement ? weightElement.textContent.trim() : '',
                    price: price,
                    mrp: mrp,
                    discount: discount,
                    image: imageElement ? imageElement.src : '',
                    url: item.querySelector('a') ? 'https://www.bigbasket.com' + item.querySelector('a').getAttribute('href') : '',
                    rating: ratingElement ? parseFloat(ratingElement.textContent) : null,
                    ratingCount: ratingCountElement ? parseInt(ratingCountElement.textContent.match(/\d+/)[0]) : 0
                };
            });
        });
        console.log('Products:', products);

        // Filter products with missing values
        // const filteredProducts = products.filter(product => product.name && product.weight && product.price && product.mrp && product.image && product.url);
        // console.log('Filtered Products:', filteredProducts);

        // Clean up
        if (page) {
            await page.close();
        }

        res.status(200).json(products);

    } catch (error) {
        console.error('BigBasket scraping error:', error);
        if (page) {
            await page.close();
        }
        // If there was an error setting location, don't store the context
        if (context && !hasStoredLocation(pincode)) {
            await context.close();
        }
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch BigBasket products'));
    }
};

// Add cleanup endpoint
export const cleanupBrowser = async (req, res, next) => {
    try {
        await cleanup();
        res.status(200).json({ message: 'Browser and contexts cleaned up successfully' });
    } catch (error) {
        next(error);
    }
};

export const fetchCategories = async (req, res, next) => {
    try {
        const response = await axios.get('https://www.bigbasket.com/ui-svc/v1/category-tree?x-channel=BB-PWA', {
            headers: {
                'accept': '*/*',
                'cookie': 'x-entry-context-id=100; x-entry-context=bb-b2c; _bb_locSrc=default; x-channel=pwa; PWA=1; _bb_bhid=; _bb_nhid=1723; _bb_vid=NTMwOTY4NTcxNTgzMjYwOTEw; _bb_dsevid=; _bb_dsid=; csrftoken=sSY3i39IumZPWGeSdiLTrk75ZfiRARjhsKQW4tBVAB5OBhjBY07myny3Q4z2PAnd; _bb_home_cache=952471fd.1.visitor; _bb_bb2.0=1; _is_tobacco_enabled=0; _is_bb1.0_supported=0; bb2_enabled=true; csurftoken=QrCMGQ.NTMwOTY4NTcxNTgzMjYwOTEw.1735715394543.joobZl7rDu+lkAhAiKkTSPXZkhnQY2GUAUBioJOeYso=; jarvis-id=5852cfbd-07cc-40a0-b3fb-58880d96fc00; ts=2025-01-01%2012:39:59.443; _bb_lat_long=MTcuMzU1ODcwNXw3OC40NTQ0Mjkz; _bb_cid=3; _bb_aid="MzAwNzQ5NTU2Nw=="; is_global=0; _bb_addressinfo=MTcuMzU1ODcwNXw3OC40NTQ0MjkzfE11cmlnaSBDaG93a3w1MDAwNjR8SHlkZXJhYmFkfDF8ZmFsc2V8dHJ1ZXx0cnVlfEJpZ2Jhc2tldGVlcg==; _bb_pin_code=500064; _bb_sa_ids=14657,15113; _bb_cda_sa_info=djIuY2RhX3NhLjEwMC4xNDY1NywxNTExMw==; is_integrated_sa=1'
            }
        });

        // Process the categories recursively
        const processCategories = (categories) => {
            if (!Array.isArray(categories)) return [];
            
            return categories.map(category => {
                const processedCategory = {
                    id: category.id,
                    name: category.name,
                    slug: category.slug,
                    url: category.url,
                    level: category.level,
                    type: category.type,
                    dest_type: category.dest_type,
                    dest_slug: category.dest_slug
                };

                // Process child categories if they exist
                if (category.children && Array.isArray(category.children)) {
                    processedCategory.children = processCategories(category.children);
                } else if (category.child && Array.isArray(category.child)) {
                    processedCategory.children = processCategories(category.child);
                } else {
                    processedCategory.children = [];
                }

                return processedCategory;
            });
        };

        const result = {
            categories: processCategories(response.data?.categories)
        };

        res.status(200).json(result);

    } catch (error) {
        console.error('Error fetching categories:', error.response?.data || error.message);
        next(error instanceof AppError ? error : AppError.internalError('Failed to fetch categories'));
    }
};
