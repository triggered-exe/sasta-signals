import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { FaSpinner, FaSearch, FaTimes, FaFilter, FaSortAmountDown } from 'react-icons/fa';
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
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const prevApiEndpointRef = useRef(apiEndpoint);

    // Add refs to track and cancel requests
    const abortControllerRef = useRef(null);
    const requestIdRef = useRef(0);

    // Debounce search query to avoid too many API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 500); // 500ms delay

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Reset to page 1 when debounced search query changes
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchQuery]);

    const fetchProducts = useCallback(async (page, endpoint, sort, dropped, notUpd, search = "") => {
        // Cancel any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        // Create new abort controller for this request
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Generate unique request ID
        const currentRequestId = ++requestIdRef.current;

        setIsLoading(true);
        setError(null);

        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}${endpoint}`, {
                params: {
                    page: page,
                    pageSize: PAGE_SIZE,
                    sortOrder: sort,
                    priceDropped: dropped.toString(),
                    notUpdated: notUpd.toString(),
                    search: search
                },
                signal: abortController.signal
            });

            // Only update state if this is still the most recent request
            if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
                const { data, totalPages } = response.data;
                setProducts(data);
                setTotalPages(totalPages);
            }
        } catch (err) {
            // Only handle error if this is still the most recent request and not aborted
            if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
                console.log(err);
                if (err.name !== 'CanceledError') {
                    setError("Failed to fetch products");
                    setProducts([]);
                }
            }
        } finally {
            // Only update loading state if this is still the most recent request
            if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
                setIsLoading(false);
            }
        }
    }, []);

    // Single useEffect to handle all changes with proper logic
    useEffect(() => {
        const isApiEndpointChanged = prevApiEndpointRef.current !== apiEndpoint;

        if (isApiEndpointChanged) {
            // API endpoint changed - always fetch page 1
            setCurrentPage(1);
            // Fetch products only if currentPage is 1 Since for other pages, the useEffect for currentPage will trigger
            if (currentPage === 1) {
                fetchProducts(1, apiEndpoint, sortOrder, priceDropped, notUpdated, debouncedSearchQuery);
            }
            prevApiEndpointRef.current = apiEndpoint;
        } else {
            // Other parameters changed - fetch current page
            fetchProducts(currentPage, apiEndpoint, sortOrder, priceDropped, notUpdated, debouncedSearchQuery);
        }
    }, [currentPage, apiEndpoint, sortOrder, priceDropped, notUpdated, debouncedSearchQuery, fetchProducts]);

    // Cleanup function to cancel any pending requests on unmount
    useEffect(() => {
        return () => {
            // This runs ONCE when component UNMOUNTS
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

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

    const handleSearchChange = (e) => {
        setSearchQuery(e.target.value);
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
                                {product.weight && <span>{product.weight}</span>}
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

            {/* Modern Professional Filter Section */}
            <div className="mb-8 bg-gradient-to-r from-white/95 to-gray-50/95 dark:from-gray-800/95 dark:to-gray-900/95 rounded-2xl shadow-xl backdrop-blur-lg border border-gray-200/30 dark:border-gray-700/30 overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 dark:from-blue-600/20 dark:to-purple-600/20 px-6 py-4 border-b border-gray-200/20 dark:border-gray-700/20">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-500/20 dark:bg-blue-600/30 rounded-lg">
                            <FaFilter className="text-blue-600 dark:text-blue-400 text-lg" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                            Filter & Search Products
                        </h3>
                    </div>
                </div>

                {/* Single Row Filter Controls */}
                <div className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:space-x-4 space-y-4 lg:space-y-0">
                        {/* Search Section */}
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <FaSearch className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                                </div>
                                <input
                                    type="text"
                                    id="searchQuery"
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                    placeholder="Search products..."
                                    className="w-full pl-11 pr-12 py-3 bg-white/80 dark:bg-gray-700/80 border border-gray-300/50 dark:border-gray-600/50 rounded-xl text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200 shadow-sm hover:shadow-md"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery("")}
                                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                        title="Clear search"
                                    >
                                        <FaTimes className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Sort Section */}
                        <div className="flex items-center space-x-2">
                            <FaSortAmountDown className="text-gray-600 dark:text-gray-400 text-sm" />
                            <div className="relative">
                                <select
                                    id="sortOrder"
                                    value={sortOrder}
                                    onChange={handleSortChange}
                                    className="py-3 px-4 pr-10 bg-white/80 dark:bg-gray-700/80 border border-gray-300/50 dark:border-gray-600/50 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200 shadow-sm hover:shadow-md appearance-none cursor-pointer min-w-[140px]"
                                >
                                    <option value="discount">🔥 Discount</option>
                                    <option value="price">💰 Price ↑</option>
                                    <option value="price_desc">💎 Price ↓</option>
                                </select>
                                <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        {/* Price Dropped Filter */}
                        <label className="flex items-center space-x-2 cursor-pointer group">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    id="priceDropped"
                                    checked={priceDropped}
                                    onChange={handlePriceDroppedChange}
                                    className="sr-only"
                                />
                                <div className={`w-5 h-5 rounded-md border-2 transition-all duration-200 ${priceDropped
                                    ? 'bg-green-500 border-green-500 dark:bg-green-600 dark:border-green-600'
                                    : 'border-gray-300 dark:border-gray-600 group-hover:border-green-400'
                                    }`}>
                                    {priceDropped && (
                                        <svg className="w-3 h-3 text-white absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                Price Dropped (2hrs)
                            </span>
                        </label>

                        {/* Not Updated Filter */}
                        <label className="flex items-center space-x-2 cursor-pointer group">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    id="notUpdated"
                                    checked={notUpdated}
                                    onChange={handleNotUpdatedChange}
                                    className="sr-only"
                                />
                                <div className={`w-5 h-5 rounded-md border-2 transition-all duration-200 ${notUpdated
                                    ? 'bg-orange-500 border-orange-500 dark:bg-orange-600 dark:border-orange-600'
                                    : 'border-gray-300 dark:border-gray-600 group-hover:border-orange-400'
                                    }`}>
                                    {notUpdated && (
                                        <svg className="w-3 h-3 text-white absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                Stale Data (2+ days)
                            </span>
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