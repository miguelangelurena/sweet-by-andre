import { useEffect, useState } from "react";
import Header from "./components/layout/Header";
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import AdminProducts from "./pages/AdminProducts";
import AdminGuard from "./components/auth/AdminGuard";
import AdminLogin from "./pages/AdminLogin";
import AdminLayout from "./components/layout/AdminLayout";
import ProductDetail from "./pages/ProductDetail";

export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    // Reset scroll when navigating between pages
    const isPageRoute =
      hash === "#catalog" ||
      hash.startsWith("#product/") ||
      hash === "#admin/products" ||
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
