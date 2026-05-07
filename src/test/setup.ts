import "@testing-library/jest-dom";
import { beforeEach, vi } from "vitest";

const TEST_ENV_DEFAULTS: Record<string, string> = {
  VITE_CHORUS_ENV: "qualif",
  VITE_CHORUS_MODE: "direct",
  VITE_CHORUS_ENABLED: "true",
  VITE_CHORUS_CONNECTION_TEST_METHOD: "GET",
  VITE_CHORUS_SUBMISSION_BRIDGE_URL: "http://127.0.0.1:8008/api/chorus/submit",
  VITE_CHORUS_SUBMISSION_SUPPLIER_ID: "26359578",
  VITE_CHORUS_PROD_SUBMISSION_SUPPLIER_ID: "",
  VITE_CHORUS_QUALIF_SUBMISSION_SUPPLIER_ID: "26359578",
  VITE_DATA_API_BASE_URL: "",
  VITE_DATA_TENANT_PATH: "",
  VITE_DATA_CURRENT_USER_PATH: "",
  VITE_DATA_SUPPLIERS_PATH: "",
  VITE_DATA_PUBLIC_CUSTOMERS_PATH: "",
  VITE_DATA_PUBLIC_SERVICES_PATH: "",
  VITE_DATA_INVOICES_PATH: "",
  VITE_DATA_INVOICE_LINES_PATH: "",
  VITE_DATA_INVOICE_ATTACHMENTS_PATH: "",
  VITE_DATA_STATUS_HISTORY_PATH: "",
  VITE_DATA_API_EXCHANGE_LOGS_PATH: "",
  VITE_DATA_ASYNC_JOBS_PATH: "",
  VITE_DATA_AUDIT_LOGS_PATH: "",
  VITE_DATA_EXTRACTION_RESULTS_PATH: "",
  VITE_REFERENCE_API_BASE_URL: "",
  VITE_REFERENCE_SUPPLIERS_PATH: "",
  VITE_REFERENCE_PUBLIC_CUSTOMERS_PATH: "",
  VITE_REFERENCE_PUBLIC_SERVICES_PATH: "",
  VITE_REFERENCE_ANNUAIRE_JSON_URL: "",
  VITE_REFERENCE_ANNUAIRE_XML_URL: "",
};

beforeEach(() => {
  for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
    vi.stubEnv(key, value);
  }
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
