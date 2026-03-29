import axios from "axios";

const testApi = async () => {
    const url = "https://1.rome.api.flipkart.com/api/4/page/fetch?cacheFirst=false";
    const headers = {
        "X-User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 FKUA/msite/0.0.4/msite/Mobile ",
        "flipkart_secure": "true",
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": "https://www.flipkart.com",
        "Referer": "https://www.flipkart.com/"
    };

    const body = {
        "pageUri": "/search?q=milk&marketplace=HYPERLOCAL",
        "locationContext": {
            "pincode": 500064,
            "changed": false
        },
        "requestContext": {
            "type": "BROWSE_PAGE"
        }
    };

    try {
        console.log("Testing Flipkart Minutes API...");
        const response = await axios.post(url, body, { headers });
        console.log("Status:", response.status);
        if (response.data) {
            console.log("Success! Data received.");
            // Print top level keys to see structure
            console.log("Keys:", Object.keys(response.data));
            if (response.data.RESPONSE && response.data.RESPONSE.slots) {
                console.log("Found slots:", response.data.RESPONSE.slots.length);
            }
        }
    } catch (error) {
        console.error("API Error:", error.response ? error.response.status : error.message);
        if (error.response && error.response.data) {
            console.log("Error details:", JSON.stringify(error.response.data).substring(0, 200));
        }
    }
};

testApi();
