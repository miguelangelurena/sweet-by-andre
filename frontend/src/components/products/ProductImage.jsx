import { useState } from "react";

export default function ProductImage(props) {
  return <ImageContent key={props.src || "missing"} {...props} />;
}

function ImageContent({
  src,
  alt = "",
  className,
  loading,
  fallback = "Photo coming soon",
  fallbackClassName = "flex h-full w-full items-center justify-center px-3 text-center text-sm text-[#B76473]",
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={fallbackClassName}
        role={alt ? "img" : undefined}
        aria-label={alt ? `${alt} — photo unavailable` : undefined}
      >
        {fallback}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => setFailed(true)}
    />
  );
}
