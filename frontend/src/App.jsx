import { useEffect, useState } from "react";
import Header from "./components/layout/Header";
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import AdminProducts from "./pages/AdminProducts";
import AdminGuard from "./components/auth/AdminGuard";
import AdminLogin from "./pages/AdminLogin";
import AdminLayout from "./components/layout/AdminLayout";

export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash);
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Login administrativo
  if (hash === "#admin/login") {
    return <AdminLogin />;
  }

  // Panel administrativo protegido
  if (hash === "#admin/products") {
    return (
      <AdminGuard>
        <AdminLayout>
          <AdminProducts />
        </AdminLayout>
      </AdminGuard>
    );
  }

  // Páginas públicas
  const isCatalog = hash === "#catalog";

  return (
    <>
      <Header />
      {isCatalog ? <Catalog /> : <Home />}
    </>
  );
}
