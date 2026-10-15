import type { Store } from "./types";

let cached: Store | null = null;
/** STORE=file (desenvolvimento local, arquivos em .data/) ou STORE=supabase (produção) */
export async function getStore(): Promise<Store> {
  if (!cached) {
    if (process.env.STORE === "supabase") {
      const { SupabaseStore } = await import("./supabase");
      cached = new SupabaseStore();
    } else {
      const { FileStore } = await import("./file"); // só em desenvolvimento local
      cached = new FileStore();
    }
  }
  return cached;
}
export const isLocalStore = () => process.env.STORE !== "supabase";
