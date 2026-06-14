export type SportCategory = "cycling" | "running" | "walking" | "badminton" | "strength" | "mobility" | "other";

export function classifySport(value: unknown): SportCategory {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  if (/\b(bike|biking|cycling|cyclist|ride|gravel|mountain biking|indoor cycling|virtual ride|e bike)\b/.test(text)) {
    return "cycling";
  }
  if (/\b(running|run|trail running|treadmill)\b/.test(text)) {
    return "running";
  }
  if (/\b(walking|walk|hiking|hike)\b/.test(text)) {
    return "walking";
  }
  if (/\b(badminton|racket sport|racquet sport)\b/.test(text)) {
    return "badminton";
  }
  if (/\b(strength|strength training|gym|weight training|weights|cardio|elliptical)\b/.test(text)) {
    return "strength";
  }
  if (/\b(mobility|yoga|pilates|stretching|breathwork|rehab|physio)\b/.test(text)) {
    return "mobility";
  }
  return "other";
}
