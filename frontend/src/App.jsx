import { useEffect, useState } from "react";

import PublicLayout from "./components/layout/PublicLayout";
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import AdminProducts from "./pages/AdminProducts";
import AdminOrders from "./pages/AdminOrders";
import AdminGuard from "./components/auth/AdminGuard";
import AdminLogin from "./pages/AdminLogin";
import AdminLayout from "./components/layout/AdminLayout";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import PaymentResult from "./pages/PaymentResult";
import AdminSeasonal from "./pages/AdminSeasonal";
import AdminDashboard from "./pages/AdminDashboard";
import SeasonalCollections from "./components/products/SeasonalCollections";

export default function App() {
  const paymentPath = window.location.pathname;
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const isPageRoute =
      hash === "#catalog" ||
      hash === "#seasonal" ||
      hash === "#admin/seasonal" ||
      hash === "#admin/dashboard" ||
      hash === "#cart" ||
      hash === "#checkout" ||
      hash.startsWith("#product/") ||
      hash === "#admin/products" ||
      hash === "#admin/orders" ||
      hash === "#admin/login" ||
      hash === "";

    if (isPageRoute) {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "instant",
      });
    } else if (["#home", "#menu", "#about", "#contact"].includes(hash)) {
      // The hash can mount Home from another page; scroll after it renders.
      const frame = requestAnimationFrame(() => {
        document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "auto" });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [hash]);

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash);
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Stripe redirects to pathname routes, not hash routes. Do not trust
  // the redirect itself as proof of payment.
  if (paymentPath === "/payment-success" || paymentPath === "/payment-cancelled") {
    return <PublicLayout><PaymentResult kind={paymentPath === "/payment-success" ? "success" : "cancelled"} /></PublicLayout>;
  }

  // -------------------------
  // ADMIN LOGIN
  // -------------------------

  if (hash === "#admin/login") {
    return <AdminLogin />;
  }

  // -------------------------
  // ADMIN PRODUCTS
  // -------------------------

  if (hash === "#admin/products") {
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminProducts />
        </AdminLayout>
      </AdminGuard>
    );
  }

  // -------------------------
  // ADMIN ORDERS (READ ONLY)
  // -------------------------
  if (hash === "#admin/orders") {
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminOrders />
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (hash === "#admin/dashboard") {
    return <AdminGuard><AdminLayout><AdminDashboard /></AdminLayout></AdminGuard>;
  }

  if (hash === "#admin/seasonal") {
    return <AdminGuard><AdminLayout><AdminSeasonal /></AdminLayout></AdminGuard>;
  }

  if (hash === "#seasonal") {
    return <PublicLayout><SeasonalCollections /></PublicLayout>;
  }

  // -------------------------
  // PUBLIC PRODUCT DETAIL
  // -------------------------

  const productMatch = hash.match(/^#product\/([0-9a-fA-F-]{36})$/);

  if (productMatch) {
    return (
      <PublicLayout>
        <ProductDetail productId={productMatch[1]} />
      </PublicLayout>
    );
  }

  // -------------------------
  // PUBLIC CART
  // -------------------------

  if (hash === "#cart") {
    return (
      <PublicLayout>
        <Cart
          onContinueShopping={() => {
            window.location.hash = "#catalog";
          }}
          onCheckout={() => {
            window.location.hash = "#checkout";
          }}
        />
      </PublicLayout>
    );
  }

  // -------------------------
  // GUEST CHECKOUT DETAILS
  // -------------------------

  if (hash === "#checkout") {
    return (
      <PublicLayout>
        <Checkout onBack={() => { window.location.hash = "#cart"; }} />
      </PublicLayout>
    );
  }

  // -------------------------
  // PUBLIC PAGES
  // -------------------------

  const isCatalog = hash === "#catalog";

  return (
    <PublicLayout>
      {isCatalog ? <Catalog /> : <Home />}
    </PublicLayout>
  );
}
