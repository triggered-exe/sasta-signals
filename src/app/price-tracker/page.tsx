"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { FaSpinner } from 'react-icons/fa';

interface Product {
  productId: string;
  productName: string;
  price: number;
  discount: string;
  variations: any[];
  subcategoryName: string;
  imageUrl: string;
}

export default function PriceTracker() {
  const [isTracking, setIsTracking] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20); // Page size
  const [sortOrder, setSortOrder] = useState("discount"); // Default sorting by discount
  const [priceDropped, setPriceDropped] = useState(false); // Toggle for recently updated products
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch products from the backend
  const fetchProducts = async (page: number, orderBy: string, priceDropped: boolean) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.get("/api/instamart/fetchProducts", {
        params: {
          page,
          pageSize,
          sortOrder: orderBy,
          priceDropped, // Pass the priceDropped flag to the backend
        },
      });

      const { data, totalPages } = response.data;
      setProducts(data);
      setTotalPages(totalPages);
    } catch (err) {
      setError("Failed to fetch products");
      setProducts([]); // Clear products on error
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts(currentPage, sortOrder, priceDropped);
  }, [currentPage, sortOrder, priceDropped]);

  const handleStartTracking = async () => {
    try {
      const response = await axios.post("/api/instamart/startTracking", {
        action: "start",
      });
      if (response.status === 200) {
        setIsTracking(true);
      }
    } catch (err) {
      setError("Error starting tracking");
    }
  };

  const handleStopTracking = async () => {
    try {
      const response = await axios.post("/api/instamart/startTracking", {
        action: "stop",
      });
      if (response.status === 200) {
        setIsTracking(false);
      }
    } catch (err) {
      setError("Error stopping tracking");
    }
  };

  // Pagination handlers
  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // Sorting handler
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortOrder(e.target.value);
    setCurrentPage(1); // Reset to first page when changing sort order
  };

  // Add this function to generate page numbers
  const getPageNumbers = () => {
    const pageNumbers = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(i);
    }

    return pageNumbers;
  };

  // Add this new function to handle the checkbox change
  const handlePriceDroppedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPriceDropped(e.target.checked);
    setCurrentPage(1); // Reset to first page when changing the filter
  };

  return (
    <div className="container mx-auto p-6 bg-gray-100 min-h-screen">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-center mb-8 bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-3xl font-bold text-gray-800 mb-4 sm:mb-0">Price Tracker</h2>

        <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4">
          <button
            onClick={isTracking ? handleStopTracking : handleStartTracking}
            className={`px-6 py-2 rounded-full text-white font-semibold transition-colors ${
              isTracking ? "bg-red-500 hover:bg-red-600" : "bg-green-500 hover:bg-green-600"
            }`}
          >
            {isTracking ? "Stop Tracking" : "Start Tracking"}
          </button>
          <p className={`font-medium ${isTracking ? "text-green-600" : "text-red-600"}`}>
            Status: {isTracking ? "Tracking is active" : "Tracking is inactive"}
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* Filter Section */}
      <div className="mb-6 bg-white p-6 rounded-lg shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 mb-4 sm:mb-0">
            <label htmlFor="sortOrder" className="font-semibold text-gray-700 mb-2 sm:mb-0">
              Sort By:
            </label>
            <select
              id="sortOrder"
              className="p-2 border rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-150 ease-in-out hover:bg-gray-100"
              value={sortOrder}
              onChange={handleSortChange}
            >
              <option value="price">Price (Low to High)</option>
              <option value="price_desc">Price (High to Low)</option>
              <option value="discount">Discount (High to Low)</option>
            </select>
          </div>
          {/* Recently Updated Checkbox */}
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="priceDropped"
              checked={priceDropped}
              onChange={handlePriceDroppedChange}
              className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
            />
            <label htmlFor="priceDropped" className="font-semibold text-gray-700 cursor-pointer select-none">
              Recently Dropped
            </label>
          </div>
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {isLoading ? (
          <div className="col-span-full text-center p-6 text-gray-500">
            <FaSpinner className="animate-spin inline-block mr-2" />
            Loading...
          </div>
        ) : products.length > 0 ? (
          products.map((product) => (
            <div key={product.productId} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="relative aspect-square">
                <a
                  href={`https://www.swiggy.com/instamart/item/${product.productId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={product.imageUrl || `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${product.variations?.[0]?.images?.[0]}`}
                    alt={product.productName}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-0 left-0 bg-black bg-opacity-100 text-white px-2 py-1 text-sm font-bold rounded-br-md">
                    ₹{product.price}
                  </span>
                  {product.discount && (
                    <span className="absolute top-0 right-0 bg-green-500 text-white px-2 py-1 text-xs font-bold rounded-bl-md">
                      {product.discount}%
                    </span>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-90 text-white p-1">
                    <p className="text-xs font-medium truncate">{product.productName}</p>
                  </div>
                </a>
              </div>
              <div className="p-2">
                <div className="flex flex-wrap gap-1">
                  {product.variations.map((variation) => (
                    <div key={variation.id} className="text-xs bg-gray-100 p-1 rounded-md">
                      <span className="font-medium">{variation.quantity} {variation.unit_of_measure}</span>
                      <span className="ml-1">₹{variation.offer_price || variation.store_price}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full text-center p-6 text-gray-500">
            No products available.
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="flex justify-center items-center mt-6 space-x-2">
        <button
          onClick={() => setCurrentPage(1)}
          disabled={currentPage === 1}
          className={`px-3 py-1 bg-blue-500 text-white rounded-md transition-colors ${
            currentPage === 1 ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-600"
          }`}
        >
          First
        </button>
        <button
          onClick={handlePreviousPage}
          disabled={currentPage === 1}
          className={`px-3 py-1 bg-blue-500 text-white rounded-md transition-colors ${
            currentPage === 1 ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-600"
          }`}
        >
          Previous
        </button>
        {getPageNumbers().map((pageNum) => (
          <button
            key={pageNum}
            onClick={() => setCurrentPage(pageNum)}
            className={`px-3 py-1 rounded-md transition-colors ${
              currentPage === pageNum
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {pageNum}
          </button>
        ))}
        <button
          onClick={handleNextPage}
          disabled={currentPage === totalPages}
          className={`px-3 py-1 bg-blue-500 text-white rounded-md transition-colors ${
            currentPage === totalPages ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-600"
          }`}
        >
          Next
        </button>
        <button
          onClick={() => setCurrentPage(totalPages)}
          disabled={currentPage === totalPages}
          className={`px-3 py-1 bg-blue-500 text-white rounded-md transition-colors ${
            currentPage === totalPages ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-600"
          }`}
        >
          Last
        </button>
      </div>
    </div>
  );
}
