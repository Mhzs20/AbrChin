import { ArrowLeft, Cloud } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="not-found page-view">
      <span><Cloud size={34} aria-hidden="true" /></span>
      <small>۴۰۴</small>
      <h1>این مسیر هنوز چیده نشده.</h1>
      <p>برگرد خونه یا از قطب‌نما مسیر درست رو پیدا کن.</p>
      <Link className="button button-primary" href="/">
        برگشت به خانه
        <ArrowLeft size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}
