import Header from "./Header";
import Footer from "./Footer";
import PreviewBanner from "./PreviewBanner";

export default function PublicLayout({ children }) {
  return <><PreviewBanner /><Header />{children}<Footer /></>;
}
