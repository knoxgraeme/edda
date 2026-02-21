import { NextResponse, type NextRequest } from "next/server";
import { validateSession, COOKIE_NAME } from "./lib/auth";

export function middleware(request: NextRequest) {
  const password = process.env.EDDA_PASSWORD;

  // No password configured — auth disabled
  if (!password) {
    // Don't expose the login page when auth is disabled
    if (request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Allow the login page through
  if (request.nextUrl.pathname === "/login") return NextResponse.next();

  // Check session cookie
  const session = request.cookies.get(COOKIE_NAME)?.value;
  if (session && validateSession(session)) {
    return NextResponse.next();
  }

  // API routes get a 401 JSON response instead of a redirect
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
