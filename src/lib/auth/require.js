import { redirect } from "next/navigation";
import { getSession } from "./sessions";

/**
 * The gate every /studio page calls first.
 *
 * A function rather than a layout check, because the login page lives under
 * /studio too: a layout that redirects unauthenticated visitors would redirect
 * /studio/login to itself, and the author could never reach the form.
 *
 * `redirect()` throws, so control never returns past this call in the
 * unauthenticated case — there is no "if the session is null we forgot to
 * handle it" path left for a caller to get wrong.
 */
export async function requireUser() {
  const session = await getSession();
  if (!session) {
    redirect("/studio/login");
  }
  return session;
}

/** The session, or null. For surfaces that render differently when signed in. */
export async function optionalUser() {
  return getSession();
}
