import React, { useState, useCallback, useRef, useEffect } from "react";
import MeeshoProducts from "./MeeshoProducts";
import axios from "axios";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MeeshoComponent = () => {
  const [sortOption, setSortOption] = useState("special");
  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);
  const requestIdRef = useRef(0);

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setError("Please enter a search query");
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const currentRequestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/meesho/search`, {
        params: {
          query: searchQuery.trim(),
          page: 1,
          limit: 50,
          sortOption: sortOption,
        },
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Expires: "0",
        },
        signal: abortController.signal,
      });

      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        const productsWithDiscount = response.data.map((product) => {
          const { normalDiscount, specialDiscount, specialPrice, difference } = calculateDiscount(product);
          return { ...product, normalDiscount, specialDiscount, specialPrice, difference };
        });
        setProducts(sortProducts(productsWithDiscount, sortOption));
      }
    } catch (error) {
      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        if (error.name !== "CanceledError") {
          setError("Failed to fetch Meesho products. Please try again.");
        }
      }
    } finally {
      if (currentRequestId === requestIdRef.current && !abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  };

  const calculateDiscount = (product) => {
    const originalPrice = typeof product.original_price === "number" ? product.original_price : Number(product.min_product_price);
    const offerPrice = product.min_product_price;
    let specialOfferPrice = null;

    if (product.special_offers && product.special_offers.display_text) {
      const match = product.special_offers.display_text.match(/₹([\d,]+)/);
      if (match) {
        specialOfferPrice = parseInt(match[1].replace(/,/g, ""), 10);
      }
    }

    const normalDiscount = ((originalPrice - offerPrice) / originalPrice) * 100;
    const specialDiscount = specialOfferPrice !== null ? ((originalPrice - specialOfferPrice) / originalPrice) * 100 : 0;
    const difference = specialOfferPrice !== null ? Math.round(specialDiscount - normalDiscount) : -999;

    return {
      normalDiscount: Math.round(normalDiscount),
      specialDiscount: Math.round(specialDiscount),
      specialPrice: specialOfferPrice,
      difference,
    };
  };

  const sortProducts = useCallback((products, option) => {
    return [...products].sort((a, b) => {
      switch (option) {
        case "normal":
          return b.normalDiscount - a.normalDiscount;
        case "special":
          return b.specialDiscount - a.specialDiscount;
        case "difference":
          return b.difference - a.difference;
        default:
          return 0;
      }
    });
  }, []);

  const handleSortChange = (value) => {
    setSortOption(value);
    if (products.length > 0) {
      setIsLoading(true);
      setTimeout(() => {
        setProducts(sortProducts(products, value));
        setIsLoading(false);
      }, 0);
    }
  };

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <form onSubmit={handleSearchSubmit}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center rounded-xl border bg-card p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Meesho products..."
              className="pl-9 h-9"
            />
          </div>

          <Select value={sortOption} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[180px] h-9 text-sm">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="special">Special Discount</SelectItem>
              <SelectItem value="normal">Normal Discount</SelectItem>
              <SelectItem value="difference">Difference</SelectItem>
            </SelectContent>
          </Select>

          <Button type="submit" disabled={isLoading} size="sm" className="h-9 px-4">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Searching...
              </>
            ) : (
              "Search"
            )}
          </Button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-destructive shrink-0" />
          <p className="text-sm text-destructive font-medium">{error}</p>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && products.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {products.length > 0 && <MeeshoProducts products={products} />}
    </div>
  );
};

export default MeeshoComponent;
