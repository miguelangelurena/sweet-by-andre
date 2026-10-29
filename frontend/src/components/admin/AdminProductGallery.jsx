import { useState } from "react";
import ProductImageUpload from "./ProductImageUpload";
import AdminProductImages from "./AdminProductImages";

// One workspace for uploading and managing existing photos.
export default function AdminProductGallery({ product, onClose, onImagesUpdated }) {
  const [galleryVersion, setGalleryVersion] = useState(0);
  const [notice, setNotice] = useState("");
  async function onUploaded() {
    setGalleryVersion((value) => value + 1);
    setNotice("Photo uploaded. Your gallery below is updated.");
    await onImagesUpdated?.();
  }
  return (
    <div className="scroll-mt-8 space-y-5" aria-label={`Photos for ${product.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E7DCD9] bg-[#FFF9F8] p-5">
        <div>
          <h2 className="font-serif text-2xl text-[#282323]">Photos · {product.name}</h2>
          <p className="mt-1 text-sm text-[#756B69]">Upload new photos and manage the current gallery from one place.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DCD9] bg-white px-5 py-3 text-sm font-semibold text-[#B76473] hover:bg-[#FAF0F1]">Back to products</button>
      </div>
      {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
      <ProductImageUpload productId={product.id} onUploaded={onUploaded} onCancel={onClose} />
      <AdminProductImages key={`${product.id}:${galleryVersion}`} product={product}
        onClose={onClose} onImagesUpdated={onImagesUpdated} />
    </div>
  );
}
