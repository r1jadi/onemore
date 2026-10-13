/**
 * Whether the Admin navigation link may be shown. The answer comes from the
 * backend (`GET /admin/session`): only a signed-in caller whose role the
 * database confirms as moderator/admin sees the link. While the check is
 * loading, anonymous, failed or non-staff, the link stays hidden (fail
 * closed), so it is never briefly exposed. Hiding the link is a convenience;
 * the server still enforces authorization on every admin route.
 */

import { useEffect, useState } from "react";

import { getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";

export function useAdminVisibility(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const auth = getAuthState();
      if (auth.status !== "authenticated") {
        if (!cancelled) setVisible(false);
        return;
      }
      try {
        const { fetchAdminSession } = await import("@/lib/admin/api");
        const session = await fetchAdminSession();
        if (!cancelled) setVisible(session.isStaff === true);
      } catch {
        if (!cancelled) setVisible(false);
      }
    }

    void check();
    return subscribeToAuth(() => {
      void check();
    });
  }, []);

  return visible;
}
