import axios from "axios";
import logger from "../utils/logger.js";
import { AppError } from "../utils/errorHandling.js";

const fetchMeeshoResults = async (query, page = 1, limit = 100, cursor = null) => {
    const headers = {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.7",
        "content-type": "application/json",
        "meesho-iso-country-code": "IN",
        origin: "https://www.meesho.com",
        priority: "u=1, i",
        referer: `https://www.meesho.com/search?q=${encodeURIComponent(query)}&searchType=manual&searchIdentifier=text_search`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    };

    let allResults = [];
    let currentPage = page;
    let hasMore = true;

    while (hasMore) {
        const response = await axios.post(
            "https://www.meesho.com/api/v1/products/search",
            { query, type: "text_search", page: currentPage, offset: (currentPage - 1) * limit, limit, cursor, isDevicePhone: false },
            { headers }
        );
        const newResults = response.data?.catalogs || [];
        cursor = response.data?.cursor;
        logger.info(`Meesho: page ${currentPage} returned ${newResults.length} results`);
        allResults = [...allResults, ...newResults];
        hasMore = newResults.length >= limit;
        if (hasMore) currentPage++;
    }

    return allResults.filter((p, i, self) => i === self.findIndex((t) => t.id === p.id));
};

export const search = async (req, res, next) => {
    try {
        const query = req.query.query || req.body.query;
        const page = Number(req.query.page || req.body.page || 1);
        const limit = Number(req.query.limit || req.body.limit || 1000);

        if (!query) throw AppError.badRequest("Query parameter is required");

        const results = await fetchMeeshoResults(query, page, limit, null);
        res.status(200).json(results);
    } catch (error) {
        logger.error(`Meesho: search error: ${error.message || error}`, { error });
        if (error instanceof AppError) return next(error);
        if (error.response) return next(new AppError(error.response.data, error.response.status));
        if (error.request) return next(AppError.internalError("No response from Meesho API"));
        next(AppError.internalError("Error setting up Meesho request"));
    }
};
