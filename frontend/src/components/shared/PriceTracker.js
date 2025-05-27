import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { FaSpinner } from 'react-icons/fa';
import { PAGE_SIZE } from "@/utils/constants";
import Pagination from "./Pagination";

export default function PriceTracker({ apiEndpoint }) {
    const [products, setProducts] = useState([]);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOrder, setSortOrder] = useState("discount");
    const [priceDropped, setPriceDropped] = useState(true);
    const [notUpdated, setNotUpdated] = useState(false);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const prevApiEndpointRef = useRef(apiEndpoint);

    const fetchProducts = (async (page, endpoint, sort, dropped, notUpd) => { 
        setIsLoading(true);
        setError(null);

        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}${endpoint}`, {
                params: {
                    page: page,
                    pageSize: PAGE_SIZE,
                    sortOrder: sort,
                    priceDropped: dropped.toString(),
                    notUpdated: notUpd.toString()
                }
            });

            const { data, totalPages } = response.data;
            setProducts(data);
            setTotalPages(totalPages);
        } catch (err) {
            console.log(err);
            setError("Failed to fetch products");
            setProducts([]);
        } finally {
            setIsLoading(false);
        }
    });

    // Single useEffect to handle all changes with proper logic
    useEffect(() => {
        const isApiEndpointChanged = prevApiEndpointRef.current !== apiEndpoint;

        if (isApiEndpointChanged) {
            // API endpoint changed - always fetch page 1
            setCurrentPage(1);
            // Fetch products only if currentPage is 1 Since for other pages, the useEffect for currentPage will trigger
            if(currentPage === 1) {
                fetchProducts(1, apiEndpoint, sortOrder, priceDropped, notUpdated);
            }
            prevApiEndpointRef.current = apiEndpoint;
        } else {
            // Other parameters changed - fetch current page
            fetchProducts(currentPage, apiEndpoint, sortOrder, priceDropped, notUpdated);
        }
    }, [currentPage, apiEndpoint, sortOrder, priceDropped, notUpdated]);

    const handleSortChange = (e) => {
        setSortOrder(e.target.value);
        setCurrentPage(1);
    };

    const handlePriceDroppedChange = (e) => {
        setPriceDropped(e.target.checked);
        setCurrentPage(1);
    };

    const handleNotUpdatedChange = (e) => {
        setNotUpdated(e.target.checked);
        setCurrentPage(1);
    };

    const handlePageChange = (newPage) => {
        setCurrentPage(newPage);
    };

    const renderProductCard = (product) => (
        <div key={product._id} className="w-1/2 sm:w-1/3 md:w-1/3 lg:w-1/4 xl:w-1/5 2xl:w-1/6 p-1 sm:p-2 md:p-3">
            <div className={`group ${!product.inStock ? 'opacity-70' : ''} bg-white/90 dark:bg-gray-800/90 rounded-lg sm:rounded-xl shadow-md sm:shadow-lg overflow-hidden backdrop-blur-md border border-gray-200/50 dark:border-gray-700/50 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 h-full flex flex-col`}>
                <div className="relative w-full pt-[100%]">
                    <a
                        href={product.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0"
                    >
                        <img
                            src={product.imageUrl || '/assets/images/no-image.png'}
                            alt={product.productName}
                            className={`absolute inset-0 w-full h-full object-contain bg-white dark:bg-gray-900 p-2 ${!product.inStock ? 'grayscale' : ''}`}
                            loading="lazy"
                        />
                        <span className="absolute top-1 sm:top-2 left-1 sm:left-2 bg-white/95 dark:bg-gray-800/95 text-gray-900 dark:text-gray-100 px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm font-bold rounded-lg backdrop-blur-sm shadow-sm">
                            ₹{product.price}
                        </span>
                        {product.discount > 0 && (
                            <span className="absolute top-1 sm:top-2 right-1 sm:right-2 bg-green-500/95 dark:bg-green-600/95 text-white font-semibold text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg backdrop-blur-sm shadow-sm">
                                {product.discount}%
                            </span>
                        )}
                        {!product.inStock && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="bg-red-500/90 text-white px-2 py-1 text-sm font-bold rounded-lg transform rotate-[-20deg] shadow-lg">
                                    Out of Stock
                                </span>
                            </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent text-white p-2 sm:p-3 backdrop-blur-[2px]">
                            <p className="text-xs sm:text-sm font-medium line-clamp-2">{product.productName}</p>
                        </div>
                    </a>
                </div>
                <div className="p-1.5 sm:p-2 md:p-3">
                    <div className="flex flex-wrap gap-1 sm:gap-1.5 md:gap-2">
                        <div className="text-[10px] sm:text-xs bg-gray-100/80 dark:bg-gray-700/80 px-1.5 sm:px-2 md:px-3 py-0.5 sm:py-1 md:py-1.5 rounded-md sm:rounded-lg backdrop-blur-sm">
                            <span className="font-medium dark:text-gray-200">
                            {product.unit}  {product.weight}
                            </span>
                            {product.mrp > product.price && (
                                <span className="ml-1 sm:ml-1.5 text-gray-500 dark:text-gray-400 line-through">
                                    ₹{product.mrp}
                                </span>
                            )}
                        </div>
                        {product.brand && (
                            <div className="text-[10px] sm:text-xs bg-gray-100/80 dark:bg-gray-700/80 px-1.5 sm:px-2 md:px-3 py-0.5 sm:py-1 md:py-1.5 rounded-md sm:rounded-lg backdrop-blur-sm">
                                <span className="font-medium dark:text-gray-200">{product.brand}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="container mx-auto px-4">
            {/* Error Display */}
            {error && (
                <div className="bg-red-100/90 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 mb-6 rounded-r-lg backdrop-blur-sm" role="alert">
                    <p>{error}</p>
                </div>
            )}

            {/* Filter Section */}
            <div className="mb-6 bg-white/90 dark:bg-gray-800/90 p-6 rounded-xl shadow-lg backdrop-blur-md border border-gray-200/50 dark:border-gray-700/50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 mb-4 sm:mb-0">
                        <label htmlFor="sortOrder" className="font-semibold text-gray-700 dark:text-gray-200 mb-2 sm:mb-0">
                            Sort By:
                        </label>
                        <select
                            id="sortOrder"
                            className="p-2 border rounded-lg bg-white/80 dark:bg-gray-700/80 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-600 backdrop-blur-sm"
                            value={sortOrder}
                            onChange={handleSortChange}
                        >
                            <option value="price">Price (Low to High)</option>
                            <option value="price_desc">Price (High to Low)</option>
                            <option value="discount">Discount (High to Low)</option>
                        </select>
                    </div>
                    <div className="flex items-center space-x-3">
                        <input
                            type="checkbox"
                            id="priceDropped"
                            checked={priceDropped}
                            onChange={handlePriceDroppedChange}
                            className="h-5 w-5 text-blue-600 bg-white/80 dark:bg-gray-700/80 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 cursor-pointer transition-colors"
                        />
                        <label htmlFor="priceDropped" className="font-semibold text-gray-700 dark:text-gray-200 cursor-pointer select-none">
                            Recently Dropped
                        </label>

                        <input
                            type="checkbox"
                            id="notUpdated"
                            checked={notUpdated}
                            onChange={handleNotUpdatedChange}
                            className="h-5 w-5 text-blue-600 bg-white/80 dark:bg-gray-700/80 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 cursor-pointer ml-4 transition-colors"
                        />
                        <label htmlFor="notUpdated" className="font-semibold text-gray-700 dark:text-gray-200 cursor-pointer select-none">
                            Not Updated (2+ Days)
                        </label>
                    </div>
                </div>
            </div>

            {/* Products Grid */}
            <div className="flex flex-wrap -mx-1 sm:-mx-2 md:-mx-3 mb-20">
                {isLoading ? (
                    <div className="w-full text-center p-6 text-gray-500 dark:text-gray-400">
                        <FaSpinner className="animate-spin inline-block mr-2 text-2xl" />
                        <span className="text-lg">Loading...</span>
                    </div>
                ) : products.length > 0 ? (
                    products.map(renderProductCard)
                ) : (
                    <div className="w-full text-center p-8 text-gray-500 dark:text-gray-400 text-lg">
                        No products available.
                    </div>
                )}
            </div>

            {/* Pagination Controls */}
            <div className="fixed bottom-0 inset-x-0 ml-[70px] bg-white/95 dark:bg-gray-800/95 shadow-lg p-1.5 sm:p-2 backdrop-blur-sm border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="container mx-auto px-2 sm:px-4">
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                </div>
            </div>
        </div>
    );
}