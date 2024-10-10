import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filterId, filterName, categoryName, offset } = req.body;

  try {
    const response = await axios.post(
      `https://www.swiggy.com/api/instamart/category-listing/filter?filterId=${filterId}&offset=${offset}&type=All%20Listing&filterName=${encodeURIComponent(filterName)}&storeId=1311100&categoryName=${encodeURIComponent(categoryName)}`,
      { facets: {}, sortAttribute: '' },
      {
        headers: {
          'accept-language': 'en-US,en;q=0.6',
          'sec-ch-ua': '"Brave";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'sec-ch-ua-platform': '"Windows"',
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.8',
          'sec-ch-ua-mobile': '?0',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'sec-gpc': '1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        },
      }
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error fetching subcategory data:', error);
    res.status(500).json({ error: 'Error fetching subcategory data' });
  }
}
