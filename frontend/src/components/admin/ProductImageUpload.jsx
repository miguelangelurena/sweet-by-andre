import { useEffect, useState } from "react";
import { uploadProductImage } from "../../services/api";

export default function ProductImageUpload({
  productId,
  onUploaded,
  onCancel,
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0];

    setError("");
    setFile(null);

    if (!selectedFile) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(selectedFile.type)) {
      setError("Only JPG, PNG and WebP images are allowed.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setError("The image must be smaller than 5 MB.");
      event.target.value = "";
      return;
    }

    setFile(selectedFile);
  }

  async function handleUpload() {
    if (!file || uploading) return;

    setUploading(true);
    setError("");

    try {
      await uploadProductImage(productId, file);
      onUploaded();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-[#E7DCD9] bg-white p-6">
      <h2 className="font-serif text-2xl text-[#282323]">
        Upload Product Image
      </h2>

      <p className="mt-2 text-sm text-[#756B69]">
        Choose a photo for your bakery product.
      </p>

      <div className="mt-6">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          disabled={uploading}
          className="block w-full text-sm text-[#756B69] file:mr-4 file:rounded-lg file:border-0 file:bg-[#FAF0F1] file:px-4 file:py-3 file:text-sm file:font-medium file:text-[#B76473]"
        />
      </div>

      {preview && (
        <img
          src={preview}
          alt="Selected product preview"
          className="mt-5 h-48 w-48 rounded-xl object-cover"
        />
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || uploading}
          className="cursor-pointer rounded-lg bg-[#D47783] px-5 py-3 text-sm font-semibold text-white hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? "Uploading..." : "Upload Image"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={uploading}
          className="rounded-lg border border-[#E7DCD9] px-5 py-3 text-sm text-[#756B69] hover:bg-[#FAF7F5]"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
