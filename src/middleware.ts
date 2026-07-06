import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/upload/:path*",
    "/review/:path*",
    "/archive/:path*",
    "/data-center/:path*",
    "/admin/:path*",
    "/notifications/:path*",
    "/api/images/:path*",
    "/api/spus/:path*",
    "/api/stats/:path*",
    "/api/users/:path*",
    "/api/archives/:path*",
    "/api/data-center/:path*",
    "/api/notifications/:path*",
  ],
};
