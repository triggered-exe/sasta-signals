// src/pages/api/instamart/fetchSubcategory.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Define the request body type
interface FetchSubcategoryRequest {
  filterId: string;
  filterName: string;
  categoryName: string;
  offset: number;
}

// Error response type
interface ErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filterId, filterName, categoryName, offset }: FetchSubcategoryRequest = req.body;

  try {
    const response = await axios.post(
      `https://www.swiggy.com/api/instamart/category-listing/filter?filterId=${filterId}&offset=${offset}&type=All%20Listing&filterName=${encodeURIComponent(filterName)}&storeId=1311100&categoryName=${encodeURIComponent(categoryName)}`,
      { facets: {}, sortAttribute: '' },
      {
        headers: {
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.6',
          'content-type': 'application/json',
          'matcher': '889g98e9ec77987bb9eabe7',
          'origin': 'https://www.swiggy.com',
          'priority': 'u=1, i',
         'sec-ch-ua': '"Brave";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'sec-gpc': '1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        },
      }
    );
    console.log('offset', offset);

    res.status(200).json(response.data); // Send the response data back to the client
  } catch (error) {
    console.error('Error fetching subcategory data:', error);
    res.status(500).json({ error: 'Error fetching subcategory data' });
  }
}
