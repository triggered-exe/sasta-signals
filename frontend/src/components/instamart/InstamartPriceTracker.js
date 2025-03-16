"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { FaSpinner } from 'react-icons/fa';
import { PAGE_SIZE } from "@/utils/constants";
import Pagination from "../shared/Pagination";

export default function InstamartPriceTracker() {
    const [products, setProducts] = useState([]);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOrder, setSortOrder] = useState("discount");
    const [priceDropped, setPriceDropped] = useState(true);
    const [notUpdated, setNotUpdated] = useState(false);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(false);

    const fetchProducts = async (priceDropped, notUpdated) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/instamart/products`, {
                params: {
                    page: currentPage,
                    pageSize: PAGE_SIZE,
                    sortOrder,
                    priceDropped: priceDropped.toString(),
                    notUpdated: notUpdated.toString(),
                },
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
    };

    useEffect(() => {
        fetchProducts(priceDropped, notUpdated);
    }, [currentPage, sortOrder, priceDropped, notUpdated]);

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

    // Handle page change from the pagination component
    const handlePageChange = (newPage) => {
        setCurrentPage(newPage);
    };

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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 mb-20">
                {isLoading ? (
                    <div className="col-span-full text-center p-6 text-gray-500 dark:text-gray-400">
                        <FaSpinner className="animate-spin inline-block mr-2 text-2xl" />
                        <span className="text-lg">Loading...</span>
                    </div>
                ) : products.length > 0 ? (
                    products.map((product) => (
                        <div key={product._id} className="group bg-white/90 dark:bg-gray-800/90 rounded-xl shadow-lg overflow-hidden backdrop-blur-md border border-gray-200/50 dark:border-gray-700/50 transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
                            <div className="relative aspect-square overflow-hidden">
                                <a
                                    href={`https://www.swiggy.com/stores/instamart/item/${product.productId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block h-full"
                                >
                                    <img
                                        src={product.imageUrl || 'https://via.placeholder.com/252x272'}
                                        alt={product.productName}
                                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                                    />
                                    <span className="absolute top-2 left-2 bg-white/95 dark:bg-gray-800/95 text-gray-900 dark:text-gray-100 px-3 py-1 text-sm font-bold rounded-lg backdrop-blur-sm shadow-sm">
                                        ₹{product.price}
                                    </span>
                                    {product.discount && (
                                        <span className="absolute top-2 right-2 bg-green-500/95 dark:bg-green-600/95 text-white font-semibold text-sm px-3 py-1 rounded-lg backdrop-blur-sm shadow-sm">
                                            {product.discount}% OFF
                                        </span>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-black/0 text-white p-4 backdrop-blur-[2px]">
                                        <p className="text-sm font-medium line-clamp-2">{product.productName}</p>
                                    </div>
                                </a>
                            </div>
                            <div className="p-3">
                                <div className="flex flex-wrap gap-2">
                                    <div className="text-xs bg-gray-100/80 dark:bg-gray-700/80 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                                        <span className="font-medium dark:text-gray-200">
                                            {product.quantity} {product.unit}
                                        </span>
                                        <span className="ml-1.5 dark:text-gray-200">
                                            ₹{product.price}
                                        </span>
                                        {product.mrp > product.price && (
                                            <span className="ml-1.5 text-gray-500 dark:text-gray-400 line-through">
                                                ₹{product.mrp}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full text-center p-8 text-gray-500 dark:text-gray-400 text-lg">
                        No products available.
                    </div>
                )}
            </div>

            {/* Pagination Controls */}
            <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-800/95 shadow-lg p-2 backdrop-blur-md border-t border-gray-200/50 dark:border-gray-700/50">
                <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                />
            </div>
        </div>
    );
} 