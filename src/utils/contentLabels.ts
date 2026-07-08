// Localized section labels for the book / audiobook detail screens.
// The label set is chosen from the content's own language (e.g. a Marathi book
// shows Marathi headings) rather than the app/device locale.

export interface ContentSectionLabels {
  description: string;
  chapters: string;
  details: string;
}

const LABELS: Record<string, ContentSectionLabels> = {
  Marathi: {
    description: 'पुस्तक परिचय',
    chapters: 'अध्याय',
    details: 'तपशील',
  },
  Hindi: {
    description: 'पुस्तक परिचय',
    chapters: 'अध्याय',
    details: 'विवरण',
  },
};

const DEFAULT_LABELS: ContentSectionLabels = {
  description: 'Description',
  chapters: 'Chapters',
  details: 'Details',
};

/**
 * Returns the section headings for a piece of content in its own language.
 * Falls back to English for any language we don't have translations for.
 */
export const getContentSectionLabels = (language?: string): ContentSectionLabels =>
  (language && LABELS[language]) || DEFAULT_LABELS;
