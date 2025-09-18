declare module 'wordlist-english' {
  // The package exports an object of word lists keyed by language names.
  // We keep this intentionally loose to avoid typing friction during bundling.
  const wordlists: Record<string, string[]>;
  export default wordlists;
}
