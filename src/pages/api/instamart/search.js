// pages/api/search.js
const axios = require("axios");

export default async function handler(req, res) {
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
      `https://www.swiggy.com/api/instamart/search?searchResultsOffset=${offset}&limit=40&query=${query}&storeId=${storeId}`,
      { facets: {}, sortAttribute: "" }, // Data sent in the request body
      {
        headers: {
          accept: "*/*",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"},
          "Cookie": "deviceId=s%253A32b79aff-414d-4fb0-a759-df85f541312e.H1m4Tr18pypEEkkBIa%252BCo87Ft4iraHpp4mKmAKYhaKE; tid=s%253A04235f7c-720b-4708-81ed-fb8e66252512.UUMQhremwF41QpB9G7ytmOA%252Bodh2kypFE1p%252BwMRQi4M; versionCode=1200; platform=web; subplatform=mweb; statusBarHeight=0; bottomOffset=0; genieTrackOn=false; ally-on=false; isNative=false; strId=; openIMHP=false; userLocation=%257B%2522lat%2522%253A17.3585585%252C%2522lng%2522%253A78.4553883%252C%2522address%2522%253A%2522%2522%252C%2522id%2522%253A%2522%2522%252C%2522annotation%2522%253A%2522%2522%252C%2522name%2522%253A%2522%2522%257D"

        }
      );
      
      // Log the response for debugging
    console.log("Swiggy Response Data:");

    // Send the response back to the client
    res.status(200).json(swiggyResponse.data);
  } catch (error) {
    // Log the error details
    console.error("Error fetching Swiggy data:", error);

    // Check if error has a response (meaning the server responded with an error status code)
    if (error.response) {
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
