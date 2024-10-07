"use client";
import { useState, useRef, useEffect } from "react";
import axios from "axios";

const websites = [
  {
    name: "Instamart",
    url: "https://instamart.com",
    description: "Instamart is a grocery delivery service.",
    image: "https://instamart.com/logo.png",
  },
  {
    name: "Zepto",
    url: "https://zepto.com",
    description: "Zepto is a grocery delivery service.",
    image: "https://zepto.com/logo.png",
  },
  {
    name: "Zomato",
    url: "https://zomato.com",
    description: "Zomato is a food delivery service.",
    image: "https://zomato.com/logo.png",
  },
  {
    name: "Swiggy",
    url: "https://swiggy.com",
    description: "Swiggy is a food delivery service.",
    image: "https://swiggy.com/logo.png",
  },
];

export default function Home() {
  const [selectedWebsite, setSelectedWebsite] = useState(null);
  const [websiteData, setWebsiteData] = useState([]);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // New state for modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalProducts, setModalProducts] = useState([]);
  const [modalTitle, setModalTitle] = useState("");

  const dataCache = useRef({});

  // Add this new state variable
  const [isLoading, setIsLoading] = useState(false);

  const fetchInstamartData = async () => {
    try {
      setError(null);

      if (dataCache.current["Instamart"]) {
        setWebsiteData(dataCache.current["Instamart"]);
        return;
      }

      const response = await axios.get("/api/instamart/store");
      const data = response.data?.data?.widgets[1]?.data.map(
        (item) => {
          return {
            nodeId: item.nodeId,
            name: item.displayName,
            image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${item.imageId}`,
            subCategories: item.nodes.map((node) => ({
              nodeId: node.nodeId,
              name: node.displayName,
              image: `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_294/${node.imageId}`,
              productCount: node.productCount,
            })),
          };
        }
      );

      dataCache.current["Instamart"] = data;
      setWebsiteData(data);
    } catch (err) {
      setError("Failed to fetch Instamart data");
    }
  };

  const handleWebsiteClick = (websiteName) => {
    setSelectedWebsite(websiteName);
    if (websiteName === "Instamart") {
      fetchInstamartData();
    }
  };

  const toggleCategory = (categoryId) => {
    setExpandedCategory((prev) => (prev === categoryId ? null : categoryId));
  };

  const fetchInstamartSubcategoryData = async (
    subcategory,
    offset = 0
  ) => {
    try {
      let response = await axios.post("/api/instamart/fetchSubcategory", {
        filterId: subcategory.nodeId,
        filterName: subcategory.name,
        categoryName: selectedWebsite,
        offset,
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching Instamart subcategory data", error);
      throw error; // Propagate the error to the calling function
    }
  };

  const fetchSubcategoryData = async (
    subcategory,
    offset = 0
  ) => {
    console.log("fetching subcategory data");
    let hasMore = true;
    let allItems = []; // Local variable to track all fetched items

    try {
      setModalTitle(subcategory.name);
      setIsModalOpen(true);
      setModalProducts([]); // Clear previous products
      setIsLoading(true); // Set loading to true when fetching starts

      while (hasMore) {
        if (selectedWebsite === "Instamart") {
          const response = await fetchInstamartSubcategoryData(
            subcategory,
            offset
          );

          if (!response || !response.data) {
            throw new Error("No data received from the API");
          }

          const { totalItems, widgets } = response.data;

          const items =
            widgets
              ?.filter((item) => item.type === "PRODUCT_LIST")
              .flatMap((item) => item.data) || [];

          allItems = [...allItems, ...items];

          if (allItems.length >= totalItems) {
            hasMore = false;
            // Filter out duplicate items
            const seenProductIds = new Set();
            allItems = allItems.filter((item) => {
              const isDuplicate = seenProductIds.has(item.product_id);
              seenProductIds.add(item.product_id);
              return !isDuplicate;
            });

            allItems = allItems.sort((a, b) => {
              const getDiscountPercentage = (item) => {
                const variation = item.variations?.[0];
                if (!variation) return 0;
                const storePrice = variation.price?.store_price || 0;
                const offerPrice = variation.price?.offer_price || storePrice;
                return storePrice > 0
                  ? ((storePrice - offerPrice) / storePrice) * 100
                  : 0;
              };

              return getDiscountPercentage(b) - getDiscountPercentage(a);
            });
            setModalProducts(allItems);
          }

          offset += items.length;
        }
      }
    } catch (err) {
      console.error("Error fetching subcategory data:", err);
      setError("Failed to fetch subcategory data");
    } finally {
      setIsLoading(false); // Set loading to false when fetching ends
    }
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();

    if (!searchQuery.trim()) {
      alert("Please enter a search query.");
      return;
    }

    let hasMore = true;
    let allItems = []; // Local variable to track all fetched items
    let Offset = 0; // Start with offset 0

    try {
      setError(null);
      setIsModalOpen(true);
      setModalTitle(`Search Results for "${searchQuery}"`);
      setModalProducts([]); // Clear previous products
      setIsLoading(true); // Set loading to true when fetching starts

      while (hasMore) {
        if (selectedWebsite === "Instamart") {
          // Fetch data from the API with current offset and query
          const response = await axios.post("/api/instamart/search", {
            query: searchQuery.trim(),
            Offset: Offset, // Pass the current offset for pagination
          });

          // Check if response is valid
          if (!response || !response.data) {
            throw new Error("No data received from the API");
          }

          const { totalResults, widgets } = response.data?.data;
          // Extract items of type 'PRODUCT_LIST'
          const items =
            widgets
              ?.filter((item) => item.type === "PRODUCT_LIST")
              .flatMap((item) => item.data) || [];

          allItems = [...allItems, ...items]; // Accumulate all items
          console.log("allItems", allItems);
          // Check if we have fetched all items
          if (allItems.length >= totalResults) {
            hasMore = false; // Stop fetching more items
            // Filter out duplicate items
            const seenProductIds = new Set();
            allItems = allItems.filter((item) => {
              const isDuplicate = seenProductIds.has(item.product_id);
              seenProductIds.add(item.product_id);
              return !isDuplicate;
            });
            // Sort the items based on discount percentage
            allItems = allItems.sort((a, b) => {
              const getDiscountPercentage = (item) => {
                const variation = item.variations?.[0];
                if (!variation) return 0;
                const storePrice = variation.price?.store_price || 0;
                const offerPrice = variation.price?.offer_price || storePrice;
                return storePrice > 0
                  ? ((storePrice - offerPrice) / storePrice) * 100
                  : 0;
              };

              return getDiscountPercentage(b) - getDiscountPercentage(a);
            });

            setModalProducts(allItems); // Update the modal with sorted items
            console.log("allItems", allItems);
          } else {
            Offset += 20; // Increment offset for the next request
          }
        }
      }
    } catch (err) {
      console.error("Error fetching search results:", err);
      setError("Failed to fetch search results");
      hasMore = false; // Stop fetching in case of an error
    } finally {
      setIsLoading(false); // Set loading to false when fetching ends
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalProducts([]);
    setModalTitle("");
  };

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isModalOpen]);

  return (
    <div className="flex p-4 space-x-4">
      {/* Left column: Website selection */}
      <div className="w-1/3">
        <h2 className="text-2xl font-bold mb-4">Select a Website</h2>
        {websites.map((website) => (
          <button
            key={website.name}
            className={`w-full mb-4 p-4 text-left border rounded-lg shadow-md transform transition duration-200 hover:scale-105 hover:shadow-lg ${
              selectedWebsite === website.name
                ? "bg-blue-100 border-blue-400"
                : "bg-white"
            }`}
            style={{ maxWidth: "250px" }}
            onClick={() => handleWebsiteClick(website.name)}
          >
            <div className="flex items-center">
              <div className="flex-1">
                <h3 className="text-lg font-medium">{website.name}</h3>
              </div>
              {selectedWebsite === website.name && (
                <span className="ml-2 text-green-500">✓</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Right column: Category grid */}
      <div className="w-2/3">
        <h2 className="text-2xl font-bold mb-4">Website Details</h2>
        {selectedWebsite ? (
          <>
            <form onSubmit={handleSearchSubmit} className="mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for products..."
                className="p-2 border rounded-l-lg w-2/3"
              />
              <button
                type="submit"
                className="p-2 bg-blue-500 text-white rounded-r-lg"
              >
                Search
              </button>
            </form>
            {websiteData.length > 0 ? (
              <div className="space-y-4">
                {websiteData.map((category) => (
                  <div key={category.nodeId}>
                    {/* Category Card */}
                    <div
                      className="p-4 border rounded-lg shadow-md cursor-pointer bg-white"
                      onClick={() => toggleCategory(category.nodeId)}
                    >
                      <div className="flex items-center">
                        <img
                          src={category.image}
                          alt={category.name}
                          className="w-16 h-16 object-cover rounded-md mr-4"
                        />
                        <h3 className="text-xl font-semibold flex-1">
                          {category.name}
                        </h3>
                        <span
                          className={`transform transition-transform ${
                            expandedCategory === category.nodeId
                              ? "rotate-180"
                              : "rotate-0"
                          }`}
                        >
                          ▼
                        </span>
                      </div>
                    </div>

                    {/* Subcategories Dropdown */}
                    {expandedCategory === category.nodeId && (
                      <div className="mt-2 ml-8 space-y-2">
                        {category.subCategories.map((subCategory) => (
                          <div
                            key={subCategory.nodeId}
                            className="flex items-center p-2 border rounded-md shadow-sm bg-gray-100 cursor-pointer"
                            onClick={() => fetchSubcategoryData(subCategory)}
                          >
                            <img
                              src={subCategory.image}
                              alt={subCategory.name}
                              className="w-12 h-12 object-cover rounded-md mr-4"
                            />
                            <div>
                              <p className="text-sm font-medium">
                                {subCategory.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {subCategory.productCount} products
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : error ? (
              <p className="text-red-500">{error}</p>
            ) : (
              <p>Loading data...</p>
            )}
          </>
        ) : (
          <p>Select a website to view details.</p>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-auto bg-gray-800"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="bg-white p-8 rounded-lg w-full max-w-[90vw] h-auto max-h-[90vh] overflow-y-auto relative bg-gray-300">
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-4 sticky top-0 bg-white z-10  bg-gray-300">
              <h2 id="modal-title" className="text-2xl font-bold">
                {modalTitle}
              </h2>
              <button
                onClick={closeModal}
                aria-label="Close modal"
                className="text-2xl focus:outline-none hover:text-red-600"
              >
                &times;
              </button>
            </div>

            {/* Loading Spinner */}
            {isLoading && (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            )}

            {/* Modal Content */}
            {!isLoading && (
              <div className="flex flex-wrap gap-4">
                {modalProducts.map((product, index) => {
                  // Get the first image URL or a default placeholder for the main product
                  const mainImageUrl = product.variations[0]?.images?.[0]
                    ? `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_272,w_252/${product.variations[0].images[0]}`
                    : "https://via.placeholder.com/272x252?text=No+Image";

                  // Get the base price and discount for the first variation
                  const baseVariation = product.variations[0];
                  const basePrice = baseVariation?.price?.offer_price || baseVariation?.price?.store_price || "N/A";
                  const baseDiscount = baseVariation?.price?.offer_applied?.listing_description || 
                                     baseVariation?.price?.offer_applied?.product_description || "";

                  // Construct the product URL
                  const productUrl = `https://www.swiggy.com/instamart/item/${product.product_id}?storeId=1311100`;

                  return (
                    <div key={product.product_id} className="border p-3 rounded-lg hover:shadow-lg transition-shadow duration-200 w-48">
                      <a href={productUrl} target="_blank" rel="noopener noreferrer">
                        <img
                          src={mainImageUrl}
                          alt={product.display_name}
                          className="w-full h-32 object-cover mb-2 rounded"
                        />
                        <h3 className="font-semibold mb-1 text-sm">
                          {product.display_name || "Unnamed Product"}
                        </h3>
                        <div className="flex justify-between text-sm text-gray-600 mb-1 font-semibold">
                          <span>
                            Price: {basePrice === "N/A" ? basePrice : `₹${basePrice}`}
                          </span>
                          {baseDiscount && (
                            <span className="text-green-700 text-xs">{baseDiscount}</span>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}