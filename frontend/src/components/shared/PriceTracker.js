import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { FaSpinner, FaSearch, FaTimes, FaFilter, FaSortAmountDown } from 'react-icons/fa';
import { PAGE_SIZE } from "@/utils/constants";
import CustomPagination from "./Pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PriceTracker({ apiEndpoint }) {
    const [products, setProducts] = useState([]);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOrder, setSortOrder] = useState("discount");
    const [timePeriod, setTimePeriod] = useState("1");
    const [notUpdated, setNotUpdated] = useState(false);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const prevApiEndpointRef = useRef(apiEndpoint);
    const productGridRef = useRef(null);

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

    const fetchProducts = useCallback(async (page, endpoint, sort, timePeriod, notUpd, search = "") => {
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
                    timePeriod: timePeriod,
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
                fetchProducts(1, apiEndpoint, sortOrder, timePeriod, notUpdated, debouncedSearchQuery);
            }
            prevApiEndpointRef.current = apiEndpoint;
        } else {
            // Other parameters changed - fetch current page
            fetchProducts(currentPage, apiEndpoint, sortOrder, timePeriod, notUpdated, debouncedSearchQuery);
        }
    }, [currentPage, apiEndpoint, sortOrder, timePeriod, notUpdated, debouncedSearchQuery, fetchProducts]);

    // Cleanup function to cancel any pending requests on unmount
    useEffect(() => {
        return () => {
            // This runs ONCE when component UNMOUNTS
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const handleSortChange = (value) => {
        setSortOrder(value);
        setCurrentPage(1);
    };

    const handleTimePeriodChange = (value) => {
        setTimePeriod(value);
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
        // Scroll to the top of the product grid when page changes
        // Use a small delay to ensure the new products have loaded
        setTimeout(() => {
            // console.log("Scrolling to the top of the product grid", productGridRef.current);
            if (productGridRef.current) {
                productGridRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    };

    const renderProductCard = (product) => (
        <div key={product._id} className="w-1/2 sm:w-1/3 md:w-1/3 lg:w-1/4 xl:w-1/5 2xl:w-1/6 p-1 sm:p-2 md:p-3 self-start">
            <Card className={`group flex flex-col transition-all duration-300 hover:shadow-lg hover:-translate-y-1 animate-scale-in ${!product.inStock ? 'opacity-70' : ''}`}>
                <CardHeader className="p-0 overflow-hidden rounded-t-xl mb-0">
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
                                className={`absolute inset-0 w-full h-full object-contain bg-background p-2 ${!product.inStock ? 'grayscale' : ''}`}
                                loading="lazy"
                            />
                            <div className="absolute top-2 left-2">
                                <Badge variant="secondary" className="text-xs font-bold">
                                    ₹{product.price}
                                </Badge>
                            </div>
                            {product.discount > 0 && (
                                <div className="absolute top-2 right-2">
                                    <Badge variant="default" className="text-xs font-semibold bg-green-500 hover:bg-green-600 text-white">
                                        {product.discount}%
                                    </Badge>
                                </div>
                            )}
                            {!product.inStock && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Badge variant="destructive" className="text-sm font-bold transform rotate-[-20deg]">
                                        Out of Stock
                                    </Badge>
                                </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent text-white p-3">
                                <p className="text-xs sm:text-sm font-medium line-clamp-2">{product.productName}</p>
                            </div>
                        </a>
                    </div>
                </CardHeader>
                <CardContent className="p-3 pt-3">
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="text-xs">
                            {product.weight && <span>{product.weight}</span>}
                            {product.mrp > product.price && (
                                <span className="ml-2 text-muted-foreground line-through">
                                    ₹{product.mrp}
                                </span>
                            )}
                        </Badge>
                        {product.brand && (
                            <Badge variant="outline" className="text-xs">
                                {product.brand}
                            </Badge>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );

    return (
        <div className="w-full">
            {/* Error Display */}
            {error && (
                <Card className="mb-6 border-destructive bg-destructive/10">
                    <CardContent className="p-4">
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-destructive rounded-full"></div>
                            <p className="text-destructive font-medium">{error}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Modern Professional Filter Section */}
            <Card className="mb-8 shadow-lg border-border/50 animate-slide-up">
                <CardHeader className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-b border-border/50">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-primary/20 rounded-lg shadow-sm">
                            <FaFilter className="text-primary text-lg" />
                        </div>
                        <h3 className="text-lg font-semibold text-foreground">
                            Filter & Search Products
                        </h3>
                    </div>
                </CardHeader>

                <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:space-x-4 space-y-4 lg:space-y-0">
                        {/* Search Section */}
                        <div className="flex-1 min-w-0">
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <FaSearch className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <Input
                                    type="text"
                                    id="searchQuery"
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                    placeholder="Search products..."
                                    className="pl-10 pr-10 h-12 text-base"
                                />
                                {searchQuery && (
                                    <Button
                                        onClick={() => setSearchQuery("")}
                                        variant="ghost"
                                        size="icon"
                                        className="absolute top-1/2 -translate-y-1/2 right-2 h-8 w-8 text-muted-foreground hover:text-foreground"
                                        title="Clear search"
                                    >
                                        <FaTimes className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Sort Section */}
                        <div className="flex items-center space-x-2">
                            <FaSortAmountDown className="text-muted-foreground text-sm" />
                            <Select value={sortOrder} onValueChange={handleSortChange}>
                                <SelectTrigger className="w-[180px] h-12">
                                    <SelectValue placeholder="Sort by..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="discount">🔥 Discount</SelectItem>
                                    <SelectItem value="price">💰 Price ↑</SelectItem>
                                    <SelectItem value="price_desc">💎 Price ↓</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Time Period Filter */}
                        <div className="flex items-center space-x-2">
                            <label htmlFor="timePeriod" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                                Price Dropped:
                            </label>
                            <Select value={timePeriod} onValueChange={handleTimePeriodChange}>
                                <SelectTrigger className="w-[160px] h-12">
                                    <SelectValue placeholder="Time period..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Time</SelectItem>
                                    <SelectItem value="0.5">Last 30 Minutes</SelectItem>
                                    <SelectItem value="1">Last 1 Hour</SelectItem>
                                    <SelectItem value="2">Last 2 Hours</SelectItem>
                                    <SelectItem value="6">Last 6 Hours</SelectItem>
                                    <SelectItem value="12">Last 12 Hours</SelectItem>
                                    <SelectItem value="24">Last 24 Hours</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

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
                                    ? 'bg-primary border-primary'
                                    : 'border-border group-hover:border-primary/60'
                                    }`}>
                                    {notUpdated && (
                                        <svg className="w-3 h-3 text-primary-foreground absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                            <span className="text-sm font-medium text-foreground whitespace-nowrap">
                                Stale Data (2+ days)
                            </span>
                        </label>
                    </div>
                </CardContent>
            </Card>

            {/* Products Grid */}
            <div ref={productGridRef} className="flex flex-wrap -mx-1 sm:-mx-2 md:-mx-3 min-h-[400px] items-start content-start">
                {isLoading ? (
                    <Card className="w-full">
                        <CardContent className="p-8 text-center">
                            <div className="flex items-center justify-center space-x-2 text-muted-foreground">
                                <FaSpinner className="animate-spin text-2xl" />
                                <span className="text-lg">Loading products...</span>
                            </div>
                        </CardContent>
                    </Card>
                ) : products.length > 0 ? (
                    products.map(renderProductCard)
                ) : (
                    <Card className="w-full">
                        <CardContent className="p-8 text-center">
                            <div className="text-muted-foreground text-lg">
                                No products available.
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Pagination Controls - Sticky positioning for better UX */}
            <div className="sticky bottom-0 bg-background/95 shadow-lg p-3 backdrop-blur-sm border-t border-border/50 z-10">
                <div className="container mx-auto px-4">
                    <Card className="shadow-none border-0 bg-transparent">
                        <CardContent className="p-0">
                            <CustomPagination
                                currentPage={currentPage}
                                totalPages={totalPages}
                                onPageChange={handlePageChange}
                            />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}