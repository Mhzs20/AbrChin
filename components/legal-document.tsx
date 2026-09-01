import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LegalPageNav } from "@/components/legal-page-nav";
import {
  LEGAL_CONFIG_VERSION,
  PUBLIC_CONTACT_EMAIL,
  isLegalLaunchReady,
  legalRobotsDirective,
  missingLegalLaunchFields,
} from "@/lib/legal/config";

export function legalMetadata(input: {
  title: string;
  description: string;
  canonical: string;
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.canonical },
    robots: legalRobotsDirective(),
  };
}

export function LegalDocument({
  eyebrow,
  icon,
  titleId,
  title,
  children,
  current,
}: {
  eyebrow: string;
  icon: ReactNode;
  titleId: string;
  title: string;
  children: ReactNode;
  current: string;
}) {
  const ready = isLegalLaunchReady();
  return (
    <section className="legal-page page-view" aria-labelledby={titleId}>
      <header className="page-heading">
        <div className="eyebrow">
          {icon} {eyebrow}
        </div>
        <h1 id={titleId}>{title}</h1>
        <p>
          این صفحه رفتار فعلی محصول را توصیف می‌کند و سند ثبتی نهایی شرکت نیست.
          نسخه پیکربندی حقوقی:{" "}
          <span dir="ltr">{LEGAL_CONFIG_VERSION}</span>
          {ready
            ? " مشخصات ثبتی تأییدشده در همین سند آمده است."
            : " مشخصات ثبتی شرکت هنوز توسط مالک تأمین نشده و در اینجا ساخته نشده است."}
        </p>
      </header>
      {!ready ? (
        <p className="legal-draft-banner" role="status">
          وضعیت انتشار حقوقی: پیش‌نویس رفتاری محصول. این متن قرارداد نهایی،
          شناسه ملی، نشانی، صلاحیت قضایی یا نماینده قانونی نیست. فیلدهای لازم
          مالک: {missingLegalLaunchFields().join(", ")}. تماس عمومی:{" "}
          <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} dir="ltr">
            {PUBLIC_CONTACT_EMAIL}
          </a>
        </p>
      ) : null}
      <LegalPageNav current={current} />
      <div className="legal-prose">{children}</div>
    </section>
  );
}
