import { useEffect, useState } from "react";

import Header from "./components/layout/Header";
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
    return <><Header /><PaymentResult kind={paymentPath === "/payment-success" ? "success" : "cancelled"} /></>;
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
    return <><Header /><SeasonalCollections /></>;
  }

  // -------------------------
  // PUBLIC PRODUCT DETAIL
  // -------------------------

  const productMatch = hash.match(/^#product\/([0-9a-fA-F-]{36})$/);

  if (productMatch) {
    return (
      <>
        <Header />
        <ProductDetail productId={productMatch[1]} />
      </>
    );
  }

  // -------------------------
  // PUBLIC CART
  // -------------------------

  if (hash === "#cart") {
    return (
      <>
        <Header />
        <Cart
          onContinueShopping={() => {
            window.location.hash = "#catalog";
          }}
          onCheckout={() => {
            window.location.hash = "#checkout";
          }}
        />
      </>
    );
  }

  // -------------------------
  // GUEST CHECKOUT DETAILS
  // -------------------------

  if (hash === "#checkout") {
    return (
      <>
        <Header />
        <Checkout onBack={() => { window.location.hash = "#cart"; }} />
      </>
    );
  }

  // -------------------------
  // PUBLIC PAGES
  // -------------------------

  const isCatalog = hash === "#catalog";

  return (
    <>
      <Header />
      {isCatalog ? <Catalog /> : <Home />}
    </>
  );
}
