import { useState, useRef, useEffect } from "react";
import axios from "axios";

const InstamartComponent = ({
  setIsModalOpen,
  setModalTitle,
  setModalProducts,
  setIsLoading,
  setError,
  searchQuery,
  setSearchQuery
}) => {
  const [websiteData, setWebsiteData] = useState([]);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const dataCache = useRef({});

  const fetchInstamartData = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/instamart/store-data`);
      console.log("data", response.data);
      setWebsiteData(response.data);
      setIsLoading(false);
    } catch (error) {
      setError('Failed to fetch Instamart categories');
      setIsLoading(false);
    }
  };

  const toggleCategory = (categoryId) => {
    setExpandedCategory((prev) => (prev === categoryId ? null : categoryId));
  };

  const fetchInstamartSubcategoryData = async (
    subcategory,
    offset = 0,
    categoryName
  ) => {
    try {
      console.log("fetching subcategory data", subcategory, offset);
      let response = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/instamart/subcategory-products`, {
        filterId: subcategory.nodeId,
        filterName: subcategory.name,
        categoryName: categoryName,
        offset,
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching Instamart subcategory data", error);
      throw error;
    }
  };

  const fetchSubcategoryData = async (subcategory, offset = 0) => {
    console.log("fetching subcategory data");
    let hasMore = true;
    let allItems = [];

    try {
      setModalTitle(subcategory.name);
      setIsModalOpen(true);
      setModalProducts([]);
      setIsLoading(true);

      while (hasMore) {
        console.log("websiteData", websiteData);
        const categoryName = websiteData.find(category => 
          category.subCategories.some(sub => sub.nodeId === subcategory.nodeId)
        )?.name || "";

        const response = await fetchInstamartSubcategoryData(
          subcategory,
          offset,
          categoryName
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
    } catch (err) {
      console.error("Error fetching subcategory data:", err);
      setError("Failed to fetch subcategory data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();

    if (!searchQuery.trim()) {
      alert("Please enter a search query.");
      return;
    }

    let hasMore = true;
    let allItems = [];
    let Offset = 0;

    try {
      setError(null);
      setIsModalOpen(true);
      setModalTitle(`Search Results for "${searchQuery}"`);
      setModalProducts([]);
      setIsLoading(true);

      while (hasMore) {
        const response = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/instamart/search`, {
          query: searchQuery.trim(),
          Offset: Offset,
        });

        console.log("response", response.data);

        if (!response || !response.data) {
          throw new Error("No data received from the API");
        }

        const { totalResults, widgets } = response.data?.data;
        const items =
          widgets
            ?.filter((item) => item.type === "PRODUCT_LIST")
            .flatMap((item) => item.data) || [];

        allItems = [...allItems, ...items];
        console.log("allItems", allItems);

        if (allItems.length >= totalResults) {
          hasMore = false;
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
          console.log("allItems", allItems);
        } else {
          Offset += 20;
        }
      }
    } catch (err) {
      console.error("Error fetching search results:", err);
      setError("Failed to fetch search results");
      hasMore = false;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInstamartData();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {websiteData.map((category) => (
            <div key={category.nodeId} className="flex flex-col">
              <div
                className="p-4 border rounded-lg shadow-md cursor-pointer bg-white flex-grow"
                onClick={() => toggleCategory(category.nodeId)}
              >
                <div className="flex flex-col items-center">
                  <img
                    src={category.image}
                    alt={category.name}
                    className="w-16 h-16 object-cover rounded-md mb-2"
                  />
                  <h3 className="text-lg font-semibold text-center">{category.name}</h3>
                  <span
                    className={`transform transition-transform mt-2 ${
                      expandedCategory === category.nodeId ? "rotate-180" : "rotate-0"
                    }`}
                  >
                    ▼
                  </span>
                </div>
              </div>

              {expandedCategory === category.nodeId && (
                <div className="mt-2 space-y-2">
                  {category.subCategories.map((subcategory) => (
                    <div
                      key={subcategory.nodeId}
                      className="flex items-center p-2 border rounded-md shadow-sm bg-gray-100 cursor-pointer"
                      onClick={() => fetchSubcategoryData(subcategory, 0)}
                    >
                      <img
                        src={subcategory.image}
                        alt={subcategory.name}
                        className="w-10 h-10 object-cover rounded-md mr-2"
                      />
                      <div className="flex-grow">
                        <p className="text-sm font-medium">{subcategory.name}</p>
                        <p className="text-xs text-gray-500">
                          {subcategory.productCount} products
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>Loading Instamart data...</p>
      )}
    </div>
  );
};

export default InstamartComponent;
