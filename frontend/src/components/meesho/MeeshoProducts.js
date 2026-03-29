import React from "react";
import { Badge } from "@/components/ui/badge";
import { Star, Truck } from "lucide-react";

const MeeshoProducts = ({ products }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {products.map((product, index) => {
        const mainImageUrl = product.image || "https://via.placeholder.com/272x252?text=No+Image";
        const productUrl = `https://www.meesho.com/s/p/${product.product_id}`;

        return (
          <div key={`${product.product_id}-${index}`} className="group">
            <a
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/20 hover:-translate-y-0.5"
            >
              {/* Image */}
              <div className="relative aspect-square bg-muted/30">
                <img
                  src={mainImageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />

                {/* Normal discount — top left */}
                {product.normalDiscount > 0 && (
                  <div className="absolute top-2 left-2">
                    <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-semibold px-1.5 shadow-sm">
                      {product.normalDiscount}% off
                    </Badge>
                  </div>
                )}

                {/* Special discount — top right */}
                {product.specialDiscount > 0 && (
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-purple-500 hover:bg-purple-600 text-white text-[10px] font-semibold px-1.5 shadow-sm">
                      {product.specialDiscount}% special
                    </Badge>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3 space-y-2">
                <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
                  {product.name || "Unnamed Product"}
                </p>

                {/* Price */}
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">₹{product.min_product_price}</span>
                  {product.specialPrice && (
                    <span className="text-xs font-medium text-purple-500">₹{product.specialPrice}</span>
                  )}
                </div>

                {/* Rating & shipping */}
                <div className="flex items-center justify-between">
                  {product.catalog_reviews_summary?.average_rating && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      <span>{product.catalog_reviews_summary.average_rating}</span>
                      <span>({product.catalog_reviews_summary?.rating_count})</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Truck className="h-3 w-3" />
                    <span>{product.shipping?.charges ? `₹${product.shipping.charges}` : "Free"}</span>
                  </div>
                </div>
              </div>
            </a>
          </div>
        );
      })}
    </div>
  );
};

export default MeeshoProducts;
