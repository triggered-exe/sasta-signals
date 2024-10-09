// src/pages/api/instamart/store.js
import axios from 'axios';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const response = await axios.post('https://www.swiggy.com/api/instamart/home/select-location', {
        data: {
          lat: 17.357671666296465,
          lng: 78.45465778354493,
          address: "APHB Conlony, Bahadurpura West, Hyderabad, Telangana 500064, India",
          addressId: "",
          annotation: "other",
          clientId: "INSTAMART-APP"
        }
      }, {
        headers: {
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
      });
      // const response = await axios.get('https://www.swiggy.com/api/instamart/home?clientId=INSTAMART-APP', {
      //   headers: {
      //     'sec-ch-ua': '"Brave";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
      //     'sec-ch-ua-platform': '"Windows"',
      //     'accept': '*/*',
      //     'accept-language': 'en-US,en;q=0.8',
      //     'sec-ch-ua-mobile': '?0',
      //     'sec-fetch-dest': 'empty',
      //     'sec-fetch-mode': 'cors',
      //     'sec-fetch-site': 'same-origin',
      //     'sec-gpc': '1',
      //     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      //   },
      // });

      res.status(200).json(response.data); // Return the response data as JSON
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: 'Error fetching Instamart data' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
