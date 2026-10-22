import { useState } from "react";
import { getCurrentUser, login } from "../services/api";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);

      const response = await getCurrentUser();

      if (response.user?.role !== "admin") {
        setError("This account does not have administrator access.");
        return;
      }

      window.location.hash = "#admin/products";
    } catch (err) {
      setError(err.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FAF7F5] px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#E7DCD9] bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <a href="#home" className="inline-block">
            <span className="block font-serif text-4xl text-[#282323]">
              Sweet
            </span>
            <span className="mt-1 block text-xs font-semibold tracking-[0.35em] text-[#B76473]">
              BY ANDRÉ
            </span>
          </a>

          <h1 className="mt-8 font-serif text-3xl text-[#282323]">
            Administrator Login
          </h1>

          <p className="mt-3 text-sm text-[#756B69]">
            Sign in to manage your bakery.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="admin-email"
              className="mb-2 block text-sm font-medium text-[#282323]"
            >
              Email
            </label>

            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-[#E7DCD9] px-4 py-3 text-sm outline-none focus:border-[#D47783]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="mb-2 block text-sm font-medium text-[#282323]"
            >
              Password
            </label>

            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-[#E7DCD9] px-4 py-3 text-sm outline-none focus:border-[#D47783]"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#D47783] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <a
          href="#home"
          className="mt-6 block text-center text-sm text-[#756B69] hover:text-[#B76473]"
        >
          Return to website
        </a>
      </div>
    </main>
  );
}
