import React from 'react';

const MeeshoProducts = ({ products }) => {
  return (
    <div className="flex flex-wrap gap-4">
      {products.map((product, index) => {
        const mainImageUrl = product.image || "https://via.placeholder.com/272x252?text=No+Image";
        const productUrl = `https://www.meesho.com/s/p/${product.product_id}`;

        return (
          <div 
            key={`${product.product_id}-${index}`} 
            className="border p-3 rounded-lg hover:shadow-lg transition-shadow duration-200 w-48 relative"
          >
            <a href={productUrl} target="_blank" rel="noopener noreferrer">
              <div className="relative">
                <img
                  src={mainImageUrl}
                  alt={product.name}
                  className="w-full h-32 object-cover mb-2 rounded"
                />
                <div className="absolute top-0 left-0 bg-green-500 text-white text-xs p-1 rounded-tr-lg">
                  {product.normalDiscount}%
                </div>
                <div className="absolute top-0 right-0 bg-purple-500 text-white text-xs p-1 rounded-tl-lg">
                  {product.specialDiscount}%
                </div>
                <div className="absolute top-6 left-0 bg-white text-black text-xs p-1 rounded-br-lg">
                  ₹{product.min_product_price}
                </div>
                <div className="absolute top-6 right-0 bg-white text-black text-xs p-1 rounded-bl-lg">
                  {product.specialPrice && `₹${product.specialPrice}`}
                </div>
              </div>
              <h3 className="font-semibold mb-1 text-sm truncate">
                {product.name || "Unnamed Product"}
              </h3>
              <div className="flex justify-between text-sm mb-1 font-semibold text-gray-600">
                <span>Price: ₹{product.min_product_price}</span>
                {product.specialPrice && <span>Special Price: ₹{product.specialPrice}</span>}
              </div>
              {/* <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Original Price: ₹{product.original_price}</span>
              </div> */}
              {/* <p className="text-xs text-gray-500 mb-2">{product.description}</p> */}
              <div className="flex items-center mb-2">
                <span className="text-yellow-500 mr-1">★</span>
                <span>{product.catalog_reviews_summary?.average_rating}</span>
                <span className="text-gray-500 text-sm ml-1">({product?.catalog_reviews_summary?.rating_count} ratings)</span>
              </div>
              <div className="text-sm text-gray-600">
                Shipping: ₹{product.shipping?.charges || 'Free'}
              </div>
            </a>
          </div>
        );
      })}
    </div>
  );
};

export default MeeshoProducts;
