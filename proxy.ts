import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Keeps the Supabase auth session cookie fresh on every request — without
// this, a session's access token expires mid-visit and every server-side
// auth.getUser() call (in /api/projects/*, /api/auth/signup) starts
// silently failing until the user manually logs back in.
//
// Named `proxy`, not `middleware`: this Next.js version (16) renamed the
// file/export (see node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md) — `middleware.ts` would just never run,
// with no error to say so.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // The call itself (not its return value) is what triggers a token
  // refresh when the current one is close to expiring.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Skip static assets and the app's own PWA/image files — the point is to
  // refresh cookies ahead of a page or API request, not to run on every
  // font/icon fetch.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
