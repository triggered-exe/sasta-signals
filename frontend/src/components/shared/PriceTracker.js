import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { Search, X, Loader2, Package } from "lucide-react";
import { PAGE_SIZE } from "@/utils/constants";
import CustomPagination from "./Pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

function ProductCardSkeleton() {
    return (
        <div className="rounded-xl border bg-card overflow-hidden">
            <Skeleton className="aspect-square w-full" />
            <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex gap-2">
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                </div>
            </div>
        </div>
    );
}

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

    const abortControllerRef = useRef(null);
    const requestIdRef = useRef(0);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchQuery]);

    const fetchProducts = useCallback(async (page, endpoint, sort, timePeriod, notUpd, search = "") => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        const currentRequestId = ++requestIdRef.current;

        setIsLoading(true);
        setError(null);

        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}${endpoint}`, {
                params: {
                    page,
                    pageSize: PAGE_SIZE,
                    sortOrder: sort,
                    timePeriod,
                    notUpdated: notUpd.toString(),
                    search,
                },
                signal: abortController.signal,
            });

            if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
                const { data, totalPages } = response.data;
                setProducts(data);
                setTotalPages(totalPages);
            }
        } catch (err) {
            if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
                if (err.name !== "CanceledError") {
                    setError("Failed to fetch products");
                    setProducts([]);
                }
            }
        } finally {
            if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
                setIsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        const isApiEndpointChanged = prevApiEndpointRef.current !== apiEndpoint;

        if (isApiEndpointChanged) {
            setCurrentPage(1);
            if (currentPage === 1) {
                fetchProducts(1, apiEndpoint, sortOrder, timePeriod, notUpdated, debouncedSearchQuery);
            }
            prevApiEndpointRef.current = apiEndpoint;
        } else {
            fetchProducts(currentPage, apiEndpoint, sortOrder, timePeriod, notUpdated, debouncedSearchQuery);
        }
    }, [currentPage, apiEndpoint, sortOrder, timePeriod, notUpdated, debouncedSearchQuery, fetchProducts]);

    useEffect(() => {
        return () => {
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

    const handleSearchChange = (e) => {
        setSearchQuery(e.target.value);
        setCurrentPage(1);
    };

    const handlePageChange = (newPage) => {
        setCurrentPage(newPage);
        setTimeout(() => {
            if (productGridRef.current) {
                productGridRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 100);
    };

    const renderProductCard = (product) => (
        <div key={product._id} className="group">
            <a
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/20 hover:-translate-y-0.5"
            >
                {/* Image */}
                <div className="relative aspect-square bg-muted/30">
                    <img
                        src={product.imageUrl || "/assets/images/no-image.png"}
                        alt={product.productName}
                        className={`w-full h-full object-contain p-3 ${!product.inStock ? "grayscale opacity-50" : ""}`}
                        loading="lazy"
                    />

                    {/* Price badge — top left */}
                    <div className="absolute top-2 left-2">
                        <Badge className="bg-card/90 text-foreground backdrop-blur-sm border shadow-sm text-xs font-semibold px-2">
                            ₹{product.price}
                        </Badge>
                    </div>

                    {/* Discount badge — top right */}
                    {product.discount > 0 && (
                        <div className="absolute top-2 right-2">
                            <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-2 shadow-sm">
                                {product.discount}% off
                            </Badge>
                        </div>
                    )}

                    {/* Out of stock overlay */}
                    {!product.inStock && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
                            <Badge variant="destructive" className="text-xs font-semibold -rotate-12 shadow">
                                Out of Stock
                            </Badge>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="p-3 space-y-2">
                    <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
                        {product.productName}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5">
                        {product.weight && (
                            <Badge variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
                                {product.weight}
                            </Badge>
                        )}
                        {product.mrp > product.price && (
                            <span className="text-xs text-muted-foreground line-through">
                                ₹{product.mrp}
                            </span>
                        )}
                        {product.brand && (
                            <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                                {product.brand}
                            </Badge>
                        )}
                    </div>
                </div>
            </a>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Error */}
            {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-destructive shrink-0" />
                    <p className="text-sm text-destructive font-medium">{error}</p>
                </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap rounded-xl border bg-card p-3">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="text"
                        value={searchQuery}
                        onChange={handleSearchChange}
                        placeholder="Search products..."
                        className="pl-9 pr-9 h-9"
                    />
                    {searchQuery && (
                        <Button
                            onClick={() => setSearchQuery("")}
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>

                {/* Sort */}
                <Select value={sortOrder} onValueChange={handleSortChange}>
                    <SelectTrigger className="w-[150px] h-9 text-sm">
                        <SelectValue placeholder="Sort by..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="discount">Discount</SelectItem>
                        <SelectItem value="price">Price: Low</SelectItem>
                        <SelectItem value="price_desc">Price: High</SelectItem>
                    </SelectContent>
                </Select>

                {/* Time Period */}
                <Select value={timePeriod} onValueChange={handleTimePeriodChange}>
                    <SelectTrigger className="w-[155px] h-9 text-sm">
                        <SelectValue placeholder="Price dropped" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="0.5">Last 30 min</SelectItem>
                        <SelectItem value="1">Last 1 hour</SelectItem>
                        <SelectItem value="2">Last 2 hours</SelectItem>
                        <SelectItem value="6">Last 6 hours</SelectItem>
                        <SelectItem value="12">Last 12 hours</SelectItem>
                        <SelectItem value="24">Last 24 hours</SelectItem>
                    </SelectContent>
                </Select>

                {/* Not Updated Checkbox */}
                <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap select-none">
                    <Checkbox
                        checked={notUpdated}
                        onCheckedChange={(checked) => {
                            setNotUpdated(!!checked);
                            setCurrentPage(1);
                        }}
                    />
                    <span className="text-sm text-muted-foreground">Stale (2+ days)</span>
                </label>
            </div>

            {/* Product Grid */}
            <div ref={productGridRef} className="min-h-[400px]">
                {isLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <ProductCardSkeleton key={i} />
                        ))}
                    </div>
                ) : products.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                        {products.map(renderProductCard)}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Package className="h-12 w-12 mb-3 opacity-40" />
                        <p className="text-base font-medium">No products found</p>
                        <p className="text-sm mt-1">Try adjusting your filters or search query</p>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="sticky bottom-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur-sm border-t">
                    <CustomPagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}
        </div>
    );
}