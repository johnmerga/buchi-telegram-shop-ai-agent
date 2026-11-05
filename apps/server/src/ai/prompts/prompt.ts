/**
 * A system prompt with a stable ID and a version. Changing the text means a new version, so every
 * trace shows exactly which prompt produced it.
 */
export interface Prompt {
  id: string;
  version: number;
  text: string;
}
