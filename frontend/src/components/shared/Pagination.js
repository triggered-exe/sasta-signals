import { Pagination as MUIPagination } from '@mui/material';
import { useEffect } from 'react';

export default function Pagination({
    currentPage,
    totalPages,
    onPageChange
}) {
    const handleChange = (event, value) => {
        if (value >= 1 && value <= totalPages) {
            onPageChange(value);
            // Scroll to top when page changes
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Handle keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event) => {
            // Only handle arrow keys if not typing in an input or textarea
            if (event.target.tagName.toLowerCase() === 'input' || 
                event.target.tagName.toLowerCase() === 'textarea') {
                return;
            }

            // Prevent default behavior for arrow keys
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
            }

            switch (event.key) {
                case 'ArrowLeft':
                    handleChange(null, Math.max(1, currentPage - 1));
                    break;
                case 'ArrowRight':
                    handleChange(null, Math.min(totalPages, currentPage + 1));
                    break;
                default:
                    break;
            }
        };

        // Add event listener
        window.addEventListener('keydown', handleKeyDown);

        // Cleanup
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentPage, totalPages]);

    if (totalPages <= 1) return null;

    return (
        <div className="flex justify-center mt-2 mb-1">
            <MUIPagination
                count={totalPages}
                page={currentPage}
                onChange={handleChange}
                variant="outlined"
                shape="rounded"
                size="medium"
                className="[&_.MuiPaginationItem-root]:text-gray-900 dark:[&_.MuiPaginationItem-root]:text-gray-200 
                          [&_.MuiPaginationItem-root]:border-gray-300 dark:[&_.MuiPaginationItem-root]:border-gray-600 
                          [&_.Mui-selected]:bg-blue-500 dark:[&_.Mui-selected]:bg-blue-600 
                          [&_.Mui-selected]:text-white dark:[&_.Mui-selected]:text-white 
                          [&_.Mui-selected:hover]:bg-blue-600 dark:[&_.Mui-selected:hover]:bg-blue-700
                          [&_.MuiPaginationItem-root:hover]:bg-gray-100 dark:[&_.MuiPaginationItem-root:hover]:bg-gray-700"
            />
        </div>
    );
} 