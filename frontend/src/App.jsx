import { lazy, useEffect, useState } from "react";

import PublicLayout from "./components/layout/PublicLayout";
import PreviewBanner from "./components/layout/PreviewBanner";
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
const AdminProducts = lazy(() => import("./pages/AdminProducts"));
const AdminOrders = lazy(() => import("./pages/AdminOrders"));
import AdminGuard from "./components/auth/AdminGuard";
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
import AdminLayout from "./components/layout/AdminLayout";
import ProductDetail from "./pages/ProductDetail";
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const PaymentResult = lazy(() => import("./pages/PaymentResult"));
const AdminSeasonal = lazy(() => import("./pages/AdminSeasonal"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminDelivery = lazy(() => import("./pages/AdminDelivery"));
const AdminProduction = lazy(() => import("./pages/AdminProduction"));
import SeasonalCollections from "./components/products/SeasonalCollections";
import { legacyPublicPath, productIdFromPath } from "./utils/storefrontRoutes";
import usePageMetadata from "./components/layout/PageMetadata";
import NotFound from "./pages/NotFound";

export default function App() {
  const paymentPath = window.location.pathname;
  const [hash, setHash] = useState(window.location.hash);
  usePageMetadata(hash, paymentPath);

  useEffect(() => {
    const isPageRoute =
      hash === "#catalog" ||
      hash === "#seasonal" ||
      hash === "#admin/seasonal" ||
      hash === "#admin/dashboard" ||
      hash === "#admin/delivery" ||
      hash === "#admin/production" ||
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
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ behavior: "auto" });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [hash]);

  useEffect(() => {
    const handleHashChange = () => {
      const destination = legacyPublicPath(window.location.hash);
      if (destination) {
        window.location.replace(destination + window.location.search);
        return;
      }
      setHash(window.location.hash);
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Stripe redirects to pathname routes, not hash routes. Do not trust
  // the redirect itself as proof of payment.
  if (
    paymentPath === "/payment-success" ||
    paymentPath === "/payment-cancelled"
  ) {
    return (
      <PublicLayout>
        <PaymentResult
          kind={paymentPath === "/payment-success" ? "success" : "cancelled"}
        />
      </PublicLayout>
    );
  }

  // -------------------------
  // ADMIN LOGIN
  // -------------------------

  if (hash === "#admin/login") {
    return (
      <>
        <PreviewBanner />
        <AdminLogin />
      </>
    );
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
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminDashboard />
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (hash === "#admin/delivery") {
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminDelivery />
        </AdminLayout>
      </AdminGuard>
    );
  }
  if (hash === "#admin/production") {
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminProduction />
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (hash === "#admin/seasonal") {
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminSeasonal />
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (
    hash === "#seasonal" ||
    (paymentPath === "/seasonal" &&
      !hash.startsWith("#admin") &&
      !["#cart", "#checkout"].includes(hash))
  ) {
    return (
      <PublicLayout>
        <SeasonalCollections />
      </PublicLayout>
    );
  }

  // -------------------------
  // PUBLIC PRODUCT DETAIL
  // -------------------------

  const productId = productIdFromPath(paymentPath);

  if (
    productId &&
    !hash.startsWith("#admin") &&
    !["#cart", "#checkout"].includes(hash)
  ) {
    return (
      <PublicLayout>
        <ProductDetail productId={productId} />
      </PublicLayout>
    );
  }

  // -------------------------
  // PUBLIC CART
  // -------------------------

  if (hash === "#cart" || (paymentPath === "/cart" && !hash)) {
    return (
      <PublicLayout>
        <Cart
          onContinueShopping={() => {
            window.location.assign("/catalog");
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

  if (hash === "#checkout" || (paymentPath === "/checkout" && !hash)) {
    return (
      <PublicLayout>
        <Checkout
          onBack={() => {
            window.location.hash = "#cart";
          }}
        />
      </PublicLayout>
    );
  }

  // -------------------------
  // PUBLIC PAGES
  // -------------------------

  const isCatalog = paymentPath === "/catalog";

  return (
    <PublicLayout>
      {isCatalog ? <Catalog /> : paymentPath === "/" ? <Home /> : <NotFound />}
    </PublicLayout>
  );
}
