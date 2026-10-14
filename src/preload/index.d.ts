import type { PinextApi } from "@shared/api";

declare global {
  interface Window {
    pinext: PinextApi;
  }
}

export {};
