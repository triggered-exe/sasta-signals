import React, { useState, useCallback } from 'react';
import MeeshoProducts from './MeeshoProducts';
import axios from 'axios';

const MeeshoComponent = ({
  axiosInstance,
  setIsLoading,
  setError,
  searchQuery,
  setSearchQuery,
  isLoading, // Ensure this prop is passed to control the loader visibility
}) => {
  const [sortOption, setSortOption] = useState('special');
  const [products, setProducts] = useState([]);

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setError('Please enter a search query');
      return;
    }
    setIsLoading(true); // Start loading
    setError(null);

    try {
      const response = await axiosInstance.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/meesho/search`, {
        params: { 
          query: searchQuery.trim(),
          page: 1,
          limit: 50,
          sortOption: sortOption
        },
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      });

      const productsWithDiscount = response.data.map(product => {
        const { normalDiscount, specialDiscount, specialPrice, difference } = calculateDiscount(product);
        return { ...product, normalDiscount, specialDiscount, specialPrice, difference };
      });

      setProducts(sortProducts(productsWithDiscount, sortOption));
    } catch (error) {
      setError('Failed to fetch Meesho products. Please try again.');
      console.error('Error fetching Meesho products:', error);
    } finally {
      setIsLoading(false); // End loading
    }
  };

  const calculateDiscount = (product) => {
    const originalPrice = (typeof product.original_price === 'number' ? product.original_price : Number(product.min_product_price));
    const offerPrice = product.min_product_price;
    let specialOfferPrice = null;

    if (product.special_offers && product.special_offers.display_text) {
      const match = product.special_offers.display_text.match(/₹([\d,]+)/);
      if (match) {
        specialOfferPrice = parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    const normalDiscount = ((originalPrice - offerPrice) / originalPrice) * 100;
    const specialDiscount = specialOfferPrice !== null 
      ? ((originalPrice - specialOfferPrice) / originalPrice) * 100 
      : 0;

    // Calculate difference only when there's a special offer
    const difference = specialOfferPrice !== null 
      ? Math.round(specialDiscount - normalDiscount)
      : -999; // Use a very low number for products without special offers

    return { 
      normalDiscount: Math.round(normalDiscount), 
      specialDiscount: Math.round(specialDiscount),
      specialPrice: specialOfferPrice,
      difference
    };
  };

  const sortProducts = useCallback((products, option) => {
    const sortedProducts = [...products].sort((a, b) => {
      switch (option) {
        case 'normal':
          // Sort by normal discount from high to low
          return b.normalDiscount - a.normalDiscount;
        case 'special':
          // Sort by special discount from high to low
          return b.specialDiscount - a.specialDiscount;
        case 'difference':
          // Sort by difference between special and normal discount from high to low
          return b.difference - a.difference;
        default:
          return 0;
      }
    });
    // console.log('sortedProducts', sortedProducts);
    return sortedProducts;
  }, []);

  const handleSortChange = async (e) => {
    const newSortOption = e.target.value;
    setSortOption(newSortOption);
    if (products.length > 0) {
      setIsLoading(true); // Start loading
      // Wrap in setTimeout to ensure the loader appears
      setTimeout(() => {
        setProducts(sortProducts(products, newSortOption));
        setIsLoading(false); // End loading
      }, 0);
    }
  };

  return (
    <div>
      <h3 className="text-xl font-semibold mb-4">Search Meesho Products</h3>
      <form onSubmit={handleSearchSubmit} className="mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for products..."
            className="flex-1 p-2 border rounded"
          />
          <div className="flex items-center whitespace-nowrap">
            <label htmlFor="sortOption" className="mr-2">Sort by:</label>
            <select 
              id="sortOption"
              value={sortOption} 
              onChange={handleSortChange}
              className="p-2 border rounded"
            >
              <option value="special">Special Discount</option>
              <option value="normal">Normal Discount</option>
              <option value="difference">Difference (Special - Normal)</option>
            </select>
          </div>
          <button
            type="submit"
            className="whitespace-nowrap bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            disabled={isLoading}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>
      {isLoading && (
        <>
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500 bg-white"></div>
          </div>
        </>
      )}
      {products.length > 0 && <MeeshoProducts products={products} />}
    </div>
  );
};

export default MeeshoComponent;
