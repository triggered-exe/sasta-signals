// Function to check if current time is between 12 AM and 6 AM IST
export const isNightTimeIST = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);
    const hours = istTime.getUTCHours();
    return hours >= 0 && hours < 6;
};

// Utility function to split arrays into smaller chunks for batch processing
export const chunk = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  };

  // Helper function to build MongoDB sort criteria based on user preference
export const buildSortCriteria = (sortOrder) => {
  const criteria = {};
  if (sortOrder === "price") criteria.price = 1;
  else if (sortOrder === "price_desc") criteria.price = -1;
  else if (sortOrder === "discount") criteria.discount = -1;
  return criteria;
};

// Helper function to build MongoDB match criteria for filtering products
export const buildMatchCriteria = (priceDropped, notUpdated) => {
  const criteria = { };
  if (priceDropped === "true") {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      criteria.priceDroppedAt = {
          $exists: true,
          $type: "date",
          $gte: oneHourAgo
      };
  }
  if (notUpdated === "true") {
      return {
          ...criteria,
          updatedAt: { $gt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) }
      };
  }
  return criteria;
};