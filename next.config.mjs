/** @type {import('next').NextConfig} */
const nextConfig = {
    // Disable ESLint during production builds
    eslint: {
      ignoreDuringBuilds: true,
    },
    
    // Enable strict mode for TypeScript
    typescript: {
      ignoreBuildErrors: false,
    },
  
    // Image optimization config (optional)
    images: {
      domains: ['instamart-media-assets.swiggy.com'], // Add domains for external images
      formats: ['image/avif', 'image/webp'],
    },
  };
  
  export default nextConfig;
  