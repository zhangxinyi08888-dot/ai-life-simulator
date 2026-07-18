import { splitNarrativeParagraphs } from "./narrativePresentation";
import type { StreamedNodePreview } from "./streamingJsonPreview";

export function buildNarrativeRevealFrames(title: string, description: string): StreamedNodePreview[] {
  const finalParagraphs = splitNarrativeParagraphs(description);
  if (finalParagraphs.length === 0) {
    return [{ title, paragraphs: [], descriptionComplete: true }];
  }

  return finalParagraphs.map((_, paragraphIndex) => ({
    title,
    paragraphs: finalParagraphs.slice(0, paragraphIndex + 1),
    descriptionComplete: paragraphIndex === finalParagraphs.length - 1
  }));
}
