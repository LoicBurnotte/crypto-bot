import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let static assets and public routes through
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("auth_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "fallback-secret-change-me");
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    // Invalid or expired token — clear cookie and redirect to login
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete("auth_token");
    return res;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon\\.svg|favicon\\.ico).*)"],
};
