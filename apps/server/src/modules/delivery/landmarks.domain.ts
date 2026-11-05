/** A landmark as the sales agent extracts it from a customer's message. */
export interface LandmarkName {
  name: string;
  area: string;
}

/** One spelling per landmark, so case, spacing, and Unicode forms do not split the memory. */
export function normalizeLandmark(landmark: LandmarkName): LandmarkName {
  const normalize = (text: string) =>
    text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return { name: normalize(landmark.name), area: normalize(landmark.area) };
}
