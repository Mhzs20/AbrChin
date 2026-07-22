"use client";

import { ChevronLeft } from "lucide-react";
import { useState } from "react";

const questions = [
  {
    question: "برای انتخاب باید فنی باشم؟",
    answer: "نه. نیاز و مرحله‌ی پروژه رو می‌گی؛ انتخاب فنی خروجی قطب‌نماست.",
  },
  {
    question: "خام و مدیریت‌شده چه فرقی دارن؟",
    answer: "در حالت خام کنترل فنی با خودته؛ در مدیریت‌شده، نگهداری زیرساخت هم با ابرچینه.",
  },
  {
    question: "بعداً می‌تونم منابع رو بیشتر کنم؟",
    answer: "بله. پیشنهادها برای رشد مرحله‌ای چیده می‌شن تا وقت نیاز ارتقا بدی.",
  },
  {
    question: "وردپرس یا VPS رو کِی انتخاب می‌کنم؟",
    answer: "لازم نیست اول مسیر انتخابش کنی. ابرچین بر اساس نیاز، بستر مناسب رو پیشنهاد می‌ده.",
  },
  {
    question: "قیمت نهایی چطور مشخص می‌شه؟",
    answer: "بعد از پیشنهاد اولیه، منابع و موقعیت نهایی می‌شن و قیمت شفاف اعلام می‌شه.",
  },
];

export function FaqList() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="faq-list">
      {questions.map((item, index) => {
        const open = openIndex === index;
        return (
          <button
            key={item.question}
            className={open ? "open" : ""}
            type="button"
            aria-expanded={open}
            onClick={() => setOpenIndex(open ? -1 : index)}
          >
            <span className="faq-question">{item.question}<ChevronLeft size={18} aria-hidden="true" /></span>
            <span className="faq-answer">{item.answer}</span>
          </button>
        );
      })}
    </div>
  );
}
