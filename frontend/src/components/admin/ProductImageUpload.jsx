import { useEffect, useId, useRef, useState } from "react";
import { uploadProductImage } from "../../services/api";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function ProductImageUpload({
  productId,
  onUploaded,
  onCancel,
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef(null);
  const inputId = useId();

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

    if (!selectedFile) return;

    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      setError("Only JPG, PNG and WebP images are allowed.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("The image must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    setFile(selectedFile);
  }

  function clearFile() {
    if (uploading) return;
    setFile(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!file || uploading) return;

    setUploading(true);
    setError("");
    setSuccess("");

    try {
      await uploadProductImage(productId, file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await onUploaded?.();
      setSuccess("Photo added successfully.");
    } catch (err) {
      setError(err.message || "Unable to upload the image. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="mb-8 min-w-0 rounded-2xl border border-[#E7DCD9] bg-white p-4 shadow-sm sm:p-6 lg:p-8">
      <div className="mb-6 border-b border-[#F0E7E4] pb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#B76473]">
          Product photography
        </p>
        <h2 className="font-serif text-2xl text-[#282323] sm:text-3xl">
          Upload Product Image
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#756B69]">
          Add a clear photo that shows off your bakery product. JPG, PNG and
          WebP files up to 5 MB are supported.
        </p>
      </div>

      <form onSubmit={handleUpload} className="space-y-6">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          disabled={uploading}
          className="sr-only"
          aria-describedby={`${inputId}-help`}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0">
            <label
              htmlFor={inputId}
              className={`flex min-h-52 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#E7C9CF] bg-[#FFFAFA] px-5 py-8 text-center transition-colors sm:min-h-64 ${
                uploading
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:border-[#D47783] hover:bg-[#FAF0F1]"
              }`}
            >
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FAE9ED] text-[#B76473]">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-7 w-7"
                >
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </span>
              <span className="text-base font-semibold text-[#282323]">
                {file ? "Choose a different photo" : "Choose a product photo"}
              </span>
              <span
                id={`${inputId}-help`}
                className="mt-2 text-sm text-[#756B69]"
              >
                Tap or click to browse your files
              </span>
              <span className="mt-4 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#B76473] shadow-sm">
                Browse Images
              </span>
            </label>
          </div>

          <div className="min-w-0 rounded-2xl border border-[#E7DCD9] bg-[#FAF7F5] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[#282323]">
                Image Preview
              </h3>
              {file && (
                <button
                  type="button"
                  onClick={clearFile}
                  disabled={uploading}
                  className="cursor-pointer text-xs font-semibold text-[#B76473] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            {preview ? (
              <img
                src={preview}
                alt="Preview of the selected product photo"
                className="aspect-[4/3] w-full rounded-xl bg-white object-contain"
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-[#E7DCD9] bg-white px-4 text-center text-sm text-[#9B8E8B]">
                Your selected image will appear here
              </div>
            )}
            {file && (
              <div className="mt-3 min-w-0 text-xs text-[#756B69]">
                <p
                  className="truncate font-medium text-[#282323]"
                  title={file.name}
                >
                  {file.name}
                </p>
                <p className="mt-1">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
            )}
          </div>
        </div>

        {success && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{success}</p>}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {uploading && (
          <p
            role="status"
            className="flex items-center gap-3 rounded-xl bg-[#FAF0F1] p-4 text-sm text-[#89505A]"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-[#D47783] border-t-transparent"
            />
            Uploading your image. Please wait...
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-[#F0E7E4] pt-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="min-h-12 w-full cursor-pointer rounded-xl border border-[#E7DCD9] bg-white px-6 py-3 text-sm font-semibold text-[#756B69] transition-colors hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || uploading}
            className="min-h-12 w-full cursor-pointer rounded-xl bg-[#D47783] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {uploading ? "Uploading..." : "Upload Image"}
          </button>
        </div>
      </form>
    </section>
  );
}
