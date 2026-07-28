"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";

import type { RecommendationDirection, ResourceProfile } from "@/lib/recommendation/types";

const nodes = [
  { id: "location", label: "موقعیت", icon: "location", threshold: 1, className: "node-location" },
  { id: "compute", label: "پردازش", icon: "compute", threshold: 2, className: "node-compute" },
  { id: "storage", label: "فضا", icon: "storage", threshold: 3, className: "node-storage" },
  { id: "risk", label: "ریسک", icon: "warning", threshold: 4, className: "node-risk" },
  { id: "support", label: "همراهی", icon: "managed-shield", threshold: 5, className: "node-support" },
] as const;

const stateLabels = [
  "ابرهای پراکنده",
  "داریم نیازت رو پیدا می‌کنیم",
  "موقعیت مناسب روشن شد",
  "هسته‌ی منابع شکل گرفت",
  "ریسک و رشد سنجیده شد",
  "سطح همراهی مشخص شد",
  "چینش اولیه آماده‌ست",
];

export function ConversationCloud({
  step,
  profile,
  direction,
  complete,
}: {
  step: number;
  profile: ResourceProfile;
  direction: RecommendationDirection;
  complete: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.56;
  const visibleStep = complete ? 6 : step;

  return (
    <aside className="conversation-cloud" aria-label="نمای زنده‌ی چینش زیرساخت">
      <div className="cloud-status">
        <span className="cloud-status-dot" />
        <span>نمای زنده</span>
        <strong>{stateLabels[Math.min(visibleStep, stateLabels.length - 1)]}</strong>
      </div>

      <div className={`cloud-stage cloud-stage--${direction}`}>
        <svg className="cloud-paths" viewBox="0 0 540 430" aria-hidden="true">
          <motion.path
            d="M270 215 C205 147 144 116 91 92"
            initial={false}
            animate={{ pathLength: visibleStep >= 1 ? 1 : 0.16, opacity: visibleStep >= 1 ? 1 : 0.25 }}
            transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
          />
          <motion.path
            d="M270 215 C335 145 405 125 462 96"
            initial={false}
            animate={{ pathLength: visibleStep >= 2 ? 1 : 0.16, opacity: visibleStep >= 2 ? 1 : 0.25 }}
            transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
          />
          <motion.path
            d="M270 215 C186 226 120 269 77 330"
            initial={false}
            animate={{ pathLength: visibleStep >= 3 ? 1 : 0.16, opacity: visibleStep >= 3 ? 1 : 0.25 }}
            transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
          />
          <motion.path
            d="M270 215 C356 229 420 268 468 333"
            initial={false}
            animate={{ pathLength: visibleStep >= 4 ? 1 : 0.16, opacity: visibleStep >= 4 ? 1 : 0.25 }}
            transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
          />
          <motion.path
            d="M270 215 C271 287 271 339 270 389"
            initial={false}
            animate={{ pathLength: visibleStep >= 5 ? 1 : 0.16, opacity: visibleStep >= 5 ? 1 : 0.25 }}
            transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
          />
        </svg>

        <motion.div
          className="cloud-core"
          initial={false}
          animate={{
            scale: complete ? 1.06 : 1,
            boxShadow: complete
              ? "0 28px 70px rgba(29,114,243,.28)"
              : "0 20px 52px rgba(29,114,243,.18)",
          }}
          transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
        >
          <span className="cloud-core-ring" aria-hidden="true" />
          <Image src="/assets/abrchin-symbol.svg" alt="" width={104} height={88} priority />
          <small>{complete ? "چینش پیشنهادی" : "ابرچین"}</small>
        </motion.div>

        {nodes.map((node) => {
          const active = visibleStep >= node.threshold;
          return (
            <motion.div
              key={node.id}
              className={`cloud-node ${node.className}${active ? " is-active" : ""}`}
              initial={false}
              animate={{ opacity: active ? 1 : 0.32, scale: active ? 1 : 0.88 }}
              transition={{ duration, ease: [0.2, 0.78, 0.24, 1] }}
            >
              <Image
                src={`/assets/abrchin-system/icons/${node.icon}.svg`}
                alt=""
                width={34}
                height={34}
              />
              <span>{node.label}</span>
            </motion.div>
          );
        })}
      </div>

      <div className="cloud-resource-strip" aria-live="polite">
        <span>
          <small>پردازنده</small>
          <strong dir="ltr">{profile.vcpu} vCPU</strong>
        </span>
        <span>
          <small>حافظه</small>
          <strong dir="ltr">{profile.ramGb} GB</strong>
        </span>
        <span>
          <small>فضا</small>
          <strong dir="ltr">{profile.storageGb} GB</strong>
        </span>
      </div>

      <p className="cloud-caption">
        این تصویر فقط نیازت را نشان می‌دهد؛ قیمت و ظرفیت تا دریافت داده‌ی تازه از ارائه‌دهنده
        قطعی نیست.
      </p>
    </aside>
  );
}
