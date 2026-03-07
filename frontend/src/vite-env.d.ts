/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_URL: string
  readonly VITE_STRIPE_CREATOR_LINK: string
  readonly VITE_STRIPE_PRO_LINK: string
  readonly VITE_DEV_BYPASS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
