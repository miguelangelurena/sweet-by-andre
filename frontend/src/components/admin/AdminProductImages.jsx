import { useEffect, useRef, useState } from "react";
import {
  getProductImages,
  setMainProductImage,
  deleteProductImage,
} from "../../services/api";

export default function AdminProductImages({
  product,
  onClose,
  onImagesUpdated,
}) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [imageToDelete, setImageToDelete] = useState(null);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const triggerRef = useRef(null);

  async function loadImages() {
    try {
      const data = await getProductImages(product.id);
      setImages(
        [...(data.images ?? [])].sort(
          (a, b) => a.display_order - b.display_order,
        ),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSuccess("");

    getProductImages(product.id)
      .then((data) => {
        if (active) {
          setImages(
            [...(data.images ?? [])].sort(
              (a, b) => a.display_order - b.display_order,
            ),
          );
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [product.id]);

  useEffect(() => {
    if (!imageToDelete) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = triggerRef.current;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [imageToDelete]);

  useEffect(() => {
    if (!imageToDelete) return;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (processingId === null) setImageToDelete(null);
      }

      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll("button:not([disabled])") ?? [],
      );
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [imageToDelete, processingId]);

  async function handleSetMain(imageId) {
    if (processingId !== null) return;
    try {
      setProcessingId(imageId);
      setError("");
      setSuccess("");
      await setMainProductImage(product.id, imageId);
      await loadImages();
      if (onImagesUpdated) await onImagesUpdated();
      setSuccess("Main image updated successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDelete() {
    if (!imageToDelete || processingId !== null) return;
    const imageId = imageToDelete.id;
    try {
      setProcessingId(imageId);
      setError("");
      setSuccess("");
      await deleteProductImage(product.id, imageId);
      setImageToDelete(null);
      await loadImages();
      if (onImagesUpdated) await onImagesUpdated();
      setSuccess("Image deleted successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  }

  function openDeleteDialog(image, event) {
    triggerRef.current = event.currentTarget;
    setImageToDelete(image);
  }

  const mainImageId = images[0]?.id;

  return (
    <section className="min-w-0 rounded-2xl border border-[#E7DCD9] bg-white p-4 shadow-sm sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-[#F0E6E3] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#B76473]">
            Product gallery
          </p>
          <h2 className="font-serif text-2xl text-[#282323] sm:text-3xl">
            Manage Images
          </h2>
          <p className="mt-1 break-words text-sm text-[#756B69]">
            {product.name}
          </p>
          {!loading && (
            <p className="mt-2 text-xs text-[#928581]">
              {images.length} {images.length === 1 ? "image" : "images"} · The
              first image is shown as the main photo
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={processingId !== null || imageToDelete !== null}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-[#E7DCD9] px-5 py-2.5 text-sm font-semibold text-[#4C4240] transition hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Close Gallery
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-700"
        >
          {success}
        </p>
      )}

      {loading ? (
        <div
          className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Loading images"
        >
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="animate-pulse overflow-hidden rounded-2xl border border-[#E7DCD9]"
            >
              <div className="aspect-[4/3] bg-[#F5EEEC]" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-1/2 rounded bg-[#F5EEEC]" />
                <div className="h-10 rounded bg-[#F5EEEC]" />
              </div>
            </div>
          ))}
        </div>
      ) : images.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E7DCD9] bg-[#FAF7F5] px-5 py-12 text-center">
          <p className="font-medium text-[#282323]">No images yet</p>
          <p className="mt-1 text-sm text-[#756B69]">
            Use Add Image in the product list to upload the first photo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
          {images.map((image, index) => {
            const isMain = image.id === mainImageId;
            const isProcessing = processingId !== null;
            return (
              <article
                key={image.id}
                className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E7DCD9] bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-[#FAF7F5]">
                  <img
                    src={image.image_url}
                    alt={`${product.name} — photo ${index + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {isMain && (
                    <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#986070] shadow-sm">
                      Main Image
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[#282323]">
                      Photo {index + 1}
                    </span>
                    <span className="text-xs text-[#928581]">
                      Position {image.display_order}
                    </span>
                  </div>
                  <div className="mt-auto grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                    {!isMain && (
                      <button
                        type="button"
                        onClick={() => handleSetMain(image.id)}
                        disabled={isProcessing}
                        className="min-h-11 cursor-pointer rounded-xl bg-[#D47783] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#B76473] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingId === image.id
                          ? "Processing..."
                          : "Set as Main"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => openDeleteDialog(image, event)}
                      disabled={isProcessing}
                      className={`min-h-11 cursor-pointer rounded-xl border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 ${isMain ? "sm:col-span-2 md:col-span-1 lg:col-span-2" : ""}`}
                    >
                      {processingId === image.id ? "Processing..." : "Delete"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {imageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-6">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-image-title"
            aria-describedby="delete-image-description"
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="mb-4 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
              </div>
            </div>
            <h3
              id="delete-image-title"
              className="text-center font-serif text-2xl text-[#282323]"
            >
              Delete image?
            </h3>
            <p
              id="delete-image-description"
              className="mt-3 text-center text-sm leading-6 text-[#756B69]"
            >
              Are you sure you want to delete this image? This action cannot be
              undone.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setImageToDelete(null)}
                disabled={processingId !== null}
                className="min-h-12 cursor-pointer rounded-xl border border-[#E7DCD9] px-4 py-3 text-sm font-semibold text-[#282323] transition hover:bg-[#FAF7F5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={processingId !== null}
                className="min-h-12 cursor-pointer rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processingId !== null ? "Deleting..." : "Delete Image"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
