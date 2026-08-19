interface ImportMetaEnv {
  /** Prefilled/default coordinator URL on LoginScreen -- still editable,
   * so a self-hosted `twing serve` operator can point this build at their
   * own coordinator without a rebuild. */
  readonly VITE_DEFAULT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
