import { useEffect, useState } from "react";
import { getCurrentUser } from "../../services/api";

export default function AdminGuard({ children }) {
  const [state, setState] = useState({
    loading: true,
    authorized: false,
  });

  useEffect(() => {
    let active = true;

    async function verifyAdmin() {
      try {
        const response = await getCurrentUser();

        if (!active) return;

        setState({
          loading: false,
          authorized: response.user?.role === "admin",
        });
      } catch {
        if (!active) return;

        setState({
          loading: false,
          authorized: false,
        });
      }
    }

    verifyAdmin();

    return () => {
      active = false;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF7F5]">
        <p className="text-sm text-[#756B69]">
          Verifying administrator access...
        </p>
      </div>
    );
  }

  if (!state.authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAF7F5] px-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-4xl text-[#282323]">
            Access Restricted
          </h1>

          <p className="mt-4 text-sm leading-6 text-[#756B69]">
            You must sign in with an administrator account to access this page.
          </p>

          <a
            href="#admin/login"
            className="mt-8 inline-block rounded-lg bg-[#D47783] px-6 py-3 text-sm font-semibold text-white"
          >
            Go to Login
          </a>
        </div>
      </main>
    );
  }

  return children;
}
