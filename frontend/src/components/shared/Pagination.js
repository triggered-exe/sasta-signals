import { useEffect } from 'react';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";

export default function CustomPagination({
    currentPage,
    totalPages,
    onPageChange
}) {
    const handlePageChange = (page) => {
        if (page >= 1 && page <= totalPages) {
            onPageChange(page);
            // Scroll behavior is handled by the parent component
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
                    if (currentPage > 1) {
                        handlePageChange(currentPage - 1);
                    }
                    break;
                case 'ArrowRight':
                    if (currentPage < totalPages) {
                        handlePageChange(currentPage + 1);
                    }
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

    // Generate page numbers to display
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = window.innerWidth < 640 ? 3 : 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            const start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            const end = Math.min(totalPages, start + maxVisible - 1);

            if (start > 1) {
                pages.push(1);
                if (start > 2) pages.push('ellipsis-start');
            }

            for (let i = start; i <= end; i++) {
                pages.push(i);
            }

            if (end < totalPages) {
                if (end < totalPages - 1) pages.push('ellipsis-end');
                pages.push(totalPages);
            }
        }

        return pages;
    };

    const pageNumbers = getPageNumbers();

    return (
        <Pagination>
            <PaginationContent>
                <PaginationItem>
                    <PaginationPrevious
                        onClick={() => handlePageChange(currentPage - 1)}
                        className={currentPage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                </PaginationItem>

                {pageNumbers.map((page, index) => (
                    <PaginationItem key={index}>
                        {page === 'ellipsis-start' || page === 'ellipsis-end' ? (
                            <PaginationEllipsis />
                        ) : (
                            <PaginationLink
                                onClick={() => handlePageChange(page)}
                                isActive={currentPage === page}
                                className="cursor-pointer"
                            >
                                {page}
                            </PaginationLink>
                        )}
                    </PaginationItem>
                ))}

                <PaginationItem>
                    <PaginationNext
                        onClick={() => handlePageChange(currentPage + 1)}
                        className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
} 