"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  MoneyDisplay,
  PageHeader,
} from "@/components/product";

type Item = {
  id: string;
  type: string;
  direction: string;
  amountTomanFa: string;
  balanceAfterTomanFa: string;
  description: string | null;
  createdAt: string;
  status: string;
};

const PAGE_SIZE = 20;

export function TransactionsPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const response = await fetch(
        `/api/wallet/transactions?page=${nextPage}&pageSize=${PAGE_SIZE}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "خطا");
        return;
      }
      setTotal(typeof data.total === "number" ? data.total : 0);
      setPage(nextPage);
      setItems((current) =>
        append ? [...current, ...(data.items || [])] : data.items || [],
      );
      setError("");
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  if (loading) {
    return (
      <>
        <PageHeader title="تراکنش‌ها" />
        <LoadingSkeleton rows={5} />
      </>
    );
  }
  if (error && items.length === 0) {
    return (
      <>
        <PageHeader title="تراکنش‌ها" />
        <ErrorState message={error} />
      </>
    );
  }

  const columns = [
    { key: "type", header: "نوع" },
    { key: "amount", header: "مبلغ" },
    { key: "balance", header: "مانده" },
    { key: "description", header: "توضیح" },
    { key: "createdAt", header: "زمان" },
  ];

  const rows = items.map((item) => ({
    id: item.id,
    cells: {
      type: `${item.type} · ${item.direction}`,
      amount: <MoneyDisplay amount={item.amountTomanFa} />,
      balance: <MoneyDisplay amount={item.balanceAfterTomanFa} />,
      description: item.description || "—",
      createdAt: new Date(item.createdAt).toLocaleString("fa-IR"),
    },
  }));

  const hasMore = items.length < total;

  return (
    <>
      <PageHeader title="تراکنش‌ها" description="همه حرکت‌های کیف پول شما" />
      <DataTable columns={columns} rows={rows} emptyMessage="تراکنشی ثبت نشده است." />
      {items.length === 0 ? <EmptyState title="تراکنشی ثبت نشده است." /> : null}
      {hasMore ? (
        <button
          type="button"
          className="product-btn product-btn--quiet"
          style={{ minHeight: 44, marginTop: 12 }}
          disabled={loadingMore}
          onClick={() => void loadPage(page + 1, true)}
        >
          {loadingMore ? "در حال بارگذاری…" : "نمایش بیشتر"}
        </button>
      ) : null}
      {error ? <p className="product-error">{error}</p> : null}
    </>
  );
}
