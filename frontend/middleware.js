import { NextResponse } from 'next/server';

export function middleware(request) {
  const response = NextResponse.next();
  
  // Get theme from cookie, default to 'light'
  const theme = request.cookies.get('theme')?.value || 'light';
  
  // Set theme header for server components (optional, since we're using cookies directly)
  response.headers.set('x-theme', theme);
  
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};