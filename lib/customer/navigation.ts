export const CUSTOMER_CLOUD_CONFIGURATOR_PATH = "/cloud-servers";

export function canonicalCustomerPurchasePath(pathname: string) {
  return pathname === "/account/order"
    ? CUSTOMER_CLOUD_CONFIGURATOR_PATH
    : pathname;
}

export function safeCustomerReturnPath(value: string | undefined) {
  if (
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return value;
  }
  return null;
}
