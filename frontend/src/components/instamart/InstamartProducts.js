import React from 'react';

const InstamartProducts = ({ products }) => {
  return (
    <div className="flex flex-wrap gap-4">
      {products.map((product) => {
        const mainImageUrl = product.variations[0]?.images?.[0]
          ? `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${product.variations[0].images[0]}`
          : "https://via.placeholder.com/272x252?text=No+Image";

        const baseVariation = product.variations[0];
        const basePrice = baseVariation?.price?.offer_price || baseVariation?.price?.mrp || "N/A";
        const baseDiscount = baseVariation?.price?.offer_applied?.listing_description || 
                             baseVariation?.price?.offer_applied?.product_description || "";

        const productUrl = `https://www.swiggy.com/instamart/item/${product.product_id}?storeId=1311100`;

        // Check if the product is out of stock
        const isOutOfStock = product.in_stock === false;

        return (
          <div 
            key={product.product_id} 
            className={`border p-3 rounded-lg hover:shadow-lg transition-shadow duration-200 w-48 ${
              isOutOfStock ? 'bg-gray-50' : ''
            }`}
          >
            <a href={productUrl} target="_blank" rel="noopener noreferrer">
              <div className="relative">
                <img
                  src={mainImageUrl}
                  alt={product.display_name}
                  className="w-full h-32 object-cover mb-2 rounded"
                />
                {isOutOfStock && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded">
                    <span className="text-white font-bold px-2 py-1 bg-red-500 rounded">Out of Stock</span>
                  </div>
                )}
              </div>
              <h3 className={`font-semibold mb-1 text-sm ${isOutOfStock ? 'text-gray-500' : ''}`}>
                {product.display_name || "Unnamed Product"}
              </h3>
              <div className={`flex justify-between text-sm mb-1 font-semibold ${isOutOfStock ? 'text-gray-400' : 'text-gray-600'}`}>
                <span>
                  Price: {basePrice === "N/A" ? basePrice : `₹${basePrice}`}
                </span>
                {baseDiscount && (
                  <span className={isOutOfStock ? 'text-gray-400' : 'text-green-700'}>{baseDiscount}</span>
                )}
              </div>
            </a>
            
            {product.variations.length > 1 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-blue-600">Show {product.variations.length} variations</summary>
                <div className="mt-2 space-y-2">
                  {product.variations.map((variation, varIndex) => {
                    const variationPrice = variation.price?.offer_price || variation.price?.store_price || "N/A";
                    const discount = variation.price?.offer_applied?.listing_description || 
                                     variation.price?.offer_applied?.product_description || "";
                    
                    return (
                      <div key={varIndex} className="text-xs border-t pt-2">
                        <p className="font-semibold">{variation.name || `Variation ${varIndex + 1}`}</p>
                        <div className="flex justify-between items-center">
                          <span>Price: {variationPrice === "N/A" ? variationPrice : `₹${variationPrice}`}</span>
                          {discount && <span className="text-green-600">{discount}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default InstamartProducts;
