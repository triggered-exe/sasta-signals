import express from 'express';
import axios from 'axios';
import { AppError } from '../../../errorHandling.js';

const router = express.Router();

async function fetchMeeshoSearchResults(query, page = 1, limit = 100, cursor = null) {
  // Step 1: Set up the API endpoint and headers
  const baseUrl = 'https://www.meesho.com/api/v1/products/search';
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.7',
    'content-type': 'application/json',
    'meesho-iso-country-code': 'IN',
    'origin': 'https://www.meesho.com',
    'priority': 'u=1, i',
    'referer': `https://www.meesho.com/search?q=${encodeURIComponent(query)}&searchType=manual&searchIdentifier=text_search`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'sec-gpc': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  };

  // Step 2: Initialize variables for pagination and results
  let allResults = [];
  let currentPage = page;
  let hasMore = true;

  // Step 3: Fetch results in a loop until all pages are retrieved
  while (hasMore) {
    // Step 3a: Make API request to Meesho
    const response = await axios.post(
      baseUrl,
      {
        query,
        type: "text_search",
        page: currentPage,
        offset: (currentPage - 1) * limit,
        limit,
        cursor: cursor,
        isDevicePhone: false
      },
      { headers }
    );

    // Step 3b: Extract results and update cursor
    const newResults = response.data?.catalogs || [];
    cursor = response.data?.cursor;
    console.log("newResults", newResults.length);
    // Step 3c: Append new results to the existing results
    allResults = [...allResults, ...newResults];

    // Step 3d: Check if there are more results to fetch
    if (newResults.length < limit) {
      hasMore = false;
    } else {
      currentPage++;
    }
  }

  // Step 4: Filter out duplicate products
  const uniqueProducts = allResults.filter((product, index, self) =>
    index === self.findIndex((t) => t.id === product.id)
  );

  // Step 5: Return the compiled unique results
  return uniqueProducts;
}

// Search route for Meesho
router.get('/search', async (req, res, next) => {
  try {
    // Step 1: Extract query parameters from both URL and request body
    const { query = req.query.query, page = req.query.page || 1, limit = req.query.limit || 1000 } = req.body;

    // Step 2: Validate the query parameter
    if (!query) {
      throw AppError.badRequest("Query parameter is required");
    }

    // Convert page and limit to numbers
    const pageNum = Number(page);
    const limitNum = Number(limit);

    // Step 3: Fetch Meesho search results
    const meeshoData = await fetchMeeshoSearchResults(query, pageNum, limitNum, null);
    
    // Step 4: Log the response data (for debugging)
    console.log("Meesho Response Data:", meeshoData);

    // Step 5: Send the filtered response back to the client
    res.status(200).json(meeshoData);
  } catch (error) {
    // Step 6: Error handling
    console.error('Error fetching Meesho search data:', error);
    if (error instanceof AppError) {
      next(error);
    } else if (error.response) {
      next(new AppError(error.response.data, error.response.status));
    } else if (error.request) {
      next(AppError.internalError("No response received from Meesho API. Please try again later."));
    } else {
      next(AppError.internalError("Error in setting up the request. Please try again."));
    }
  }
});

export default router;
