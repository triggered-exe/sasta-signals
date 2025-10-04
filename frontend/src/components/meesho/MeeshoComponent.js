import React, { useState, useCallback, useRef, useEffect } from 'react';
import MeeshoProducts from './MeeshoProducts';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const MeeshoComponent = () => {
  const [sortOption, setSortOption] = useState('special');
  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Add refs to track and cancel requests
  const abortControllerRef = useRef(null);
  const requestIdRef = useRef(0);

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setError('Please enter a search query');
      return;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Generate unique request ID
    const currentRequestId = ++requestIdRef.current;

    setIsLoading(true); // Start loading
    setError(null);

    try {
      const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/meesho/search`, {
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
        },
        signal: abortController.signal
      });

      // Only update state if this is still the most recent request
      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        const productsWithDiscount = response.data.map(product => {
          const { normalDiscount, specialDiscount, specialPrice, difference } = calculateDiscount(product);
          return { ...product, normalDiscount, specialDiscount, specialPrice, difference };
        });

        setProducts(sortProducts(productsWithDiscount, sortOption));
      }
    } catch (error) {
      // Only handle error if this is still the most recent request and not aborted
      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        if (error.name !== 'CanceledError') {
          setError('Failed to fetch Meesho products. Please try again.');
          console.error('Error fetching Meesho products:', error);
        }
      }
    } finally {
      // Only update loading state if this is still the most recent request
      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        setIsLoading(false); // End loading
      }
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

  // Cleanup function to cancel any pending requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="w-full">
      <h3 className="text-xl font-semibold mb-4 text-foreground">Search Meesho Products</h3>
      <form onSubmit={handleSearchSubmit} className="mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for products..."
            className="flex-1"
          />
          <div className="flex items-center whitespace-nowrap">
            <label htmlFor="sortOption" className="mr-2">Sort by:</label>
            <Select value={sortOption} onValueChange={setSortOption}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="special">Special Discount</SelectItem>
                <SelectItem value="normal">Normal Discount</SelectItem>
                <SelectItem value="difference">Difference (Special - Normal)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={isLoading}
            className="whitespace-nowrap"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </form>
      {isLoading && (
        <>
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[9999]">
            <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-primary bg-card shadow-lg"></div>
          </div>
        </>
      )}
      {products.length > 0 && <MeeshoProducts products={products} />}
    </div>
  );
};

export default MeeshoComponent;
