import axios from "axios";
import { AppError } from "../utils/errorHandling.js";
import { performZeptoSearch } from "./ZeptoController.js";
import { performFlipkartSearch } from "./FlipkartGroceryController.js";

// Provider registry mapping provider names to their search functions and configurations
const providerRegistry = {
  'zepto': {
    name: 'Zepto',
    searchFunction: performZeptoSearch,
    locationParam: 'location'
  },
  'flipkart-grocery': {
    name: 'Flipkart Grocery',
    searchFunction: performFlipkartSearch,
    locationParam: 'pincode'
  }
};

// Unified search handler
export const unifiedSearch = async (req, res, next) => {
  try {
    const { location, query, providers } = req.body;

    // Validate required parameters
    if (!location || !query) {
      throw AppError.badRequest("Location and query are required");
    }

    // Determine which providers to search
    const providersToSearch = providers || Object.keys(providerRegistry);

    // Validate providers
    const invalidProviders = providersToSearch.filter(p => !providerRegistry[p]);
    if (invalidProviders.length > 0) {
      throw AppError.badRequest(`Invalid providers: ${invalidProviders.join(', ')}`);
    }

    console.log(`UNIFIED: Starting search for "${query}" in location "${location}" across providers: ${providersToSearch.join(', ')}`);

    // Execute searches in parallel
    const searchPromises = providersToSearch.map(async (providerKey) => {
      const provider = providerRegistry[providerKey];
      
      // Validate location parameter for this provider
      if (provider.locationParam === 'pincode') {
        // Check if location is a valid 6-digit pincode
        const pincodeRegex = /^\d{6}$/;
        if (!pincodeRegex.test(location)) {
          return {
            provider: providerKey,
            success: false,
            products: [],
            total: 0,
            error: `Invalid pincode format. ${provider.name} requires a 6-digit pincode, received: "${location}"`,
            validationError: true
          };
        }
      }
      
      try {
        console.log(`UNIFIED: Searching ${provider.name}...`);
        const result = await provider.searchFunction(location, query);
        console.log(`UNIFIED: ${provider.name} returned ${result.products?.length || 0} products`);
        return {
          provider: providerKey,
          success: true,
          products: result.products || [],
          total: result.total || result.products?.length || 0,
          error: null
        };
      } catch (error) {
        console.error(`UNIFIED: Error searching ${provider.name}:`, error.message);
        return {
          provider: providerKey,
          success: false,
          products: [],
          total: 0,
          error: error.message || 'Unknown error'
        };
      }
    });

    // Wait for all searches to complete
    const searchResults = await Promise.allSettled(searchPromises);

    // Process results
    const results = {};
    let totalProviders = 0;
    let successfulProviders = 0;

    searchResults.forEach((result, index) => {
      const providerKey = providersToSearch[index];
      if (result.status === 'fulfilled') {
        results[providerKey] = result.value;
        totalProviders++;
        if (result.value.success) {
          successfulProviders++;
        }
      } else {
        // This shouldn't happen with our error handling, but just in case
        results[providerKey] = {
          provider: providerKey,
          success: false,
          products: [],
          total: 0,
          error: result.reason?.message || 'Promise rejected'
        };
        totalProviders++;
      }
    });

    // Set cache headers
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Type": "application/json",
    });

    res.status(200).json({
      success: true,
      results,
      totalProviders,
      successfulProviders,
      query,
      location
    });

  } catch (error) {
    console.error("UNIFIED: Search error:", error);
    next(error instanceof AppError ? error : AppError.internalError("Failed to perform unified search"));
  }
};