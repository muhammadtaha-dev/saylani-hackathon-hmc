import { ok, fail } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  try {
    await clearSessionCookie();
    return ok({ loggedOut: true });
  } catch (e) {
    return fail(e);
  }
}
