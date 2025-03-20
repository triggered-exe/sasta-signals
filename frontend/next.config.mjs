/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["instamart-media-assets.swiggy.com"], // Add domains for external images
    formats: ["image/avif", "image/webp"],
  }
};

export default nextConfig;
