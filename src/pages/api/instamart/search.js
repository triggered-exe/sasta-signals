// pages/api/search.ts

import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    // Extract search query and offset from the request body, with default offset value
    const { query, offset = 0 } = req.body;

    // If no query is provided, return an error
    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    // TODO: Get storeId from by sending the location to the API and reading the response

    const storeId = "1311100";

    // Make a POST request to the Swiggy API with the provided search query and offset
    const swiggyResponse = await axios.post(
      `https://www.swiggy.com/api/instamart/search?pageNumber=0&searchResultsOffset=${offset}&limit=40&query=${query}&ageConsent=false&layoutId=3990&pageType=INSTAMART_SEARCH_PAGE&isPreSearchTag=false&highConfidencePageNo=0&lowConfidencePageNo=0&storeId=${storeId}`,
      { facets: {}, sortAttribute: "" }, // Data sent in the request body
      {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.6",
          "content-type": "application/json",
          matcher: "889g98e9ec77987bb9eabe7",
          origin: "https://www.swiggy.com",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Brave";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "sec-gpc": "1",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
          cookie: "YOUR_COOKIE_HERE", // Replace with the exact cookies used in Postman
        },
      }
    );

    // Log the response for debugging
    console.log("Swiggy Response Data:", swiggyResponse.data);

    // Send the response back to the client
    res.status(200).json(swiggyResponse.data);
  } catch (error) {
    // Log the error details
    console.error("Error fetching Swiggy data:", error);

    // Check if error has a response (meaning the server responded with an error status code)
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
      console.error("Response headers:", error.response.headers);

      // Send the error status and message back to the client
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      // No response received from the server
      console.error("No response received:", error.request);

      return res.status(500).json({
        error: "No response received from Swiggy API. Please try again later.",
      });
    } else {
      // Other errors (e.g., setting up the request)
      console.error("Error in setting up request:", error.message);

      return res
        .status(500)
        .json({ error: "Error in setting up the request. Please try again." });
    }
  }
}
